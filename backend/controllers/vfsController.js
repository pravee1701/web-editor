import File from '../models/fileModel.js';
import User from '../models/userModel.js'; 

import path from 'path';
import { promises as fsPromises, existsSync } from 'fs';
import mongoose from 'mongoose';

const BASE_PROJECT_DIR = path.resolve(process.cwd(), 'projects');

async function copyVfsNodeRecursive(nodeIdToCopy, targetUserId, targetParentId, isTemplateBeingCreated, newTemplateType, nameOverride = null) {
    const originalNode = await File.findById(nodeIdToCopy).lean();
    if (!originalNode) { console.warn(`VFS_COPY_HELPER: Original node ${nodeIdToCopy} not found.`); return null; }
    const newNodeData = {
        userId: targetUserId, name: nameOverride || originalNode.name, type: originalNode.type,
        content: originalNode.type === 'file' ? (originalNode.content || '') : undefined,
        parentId: targetParentId, isTemplate: isTemplateBeingCreated,
        templateType: isTemplateBeingCreated ? newTemplateType : undefined,
    };
    if (newNodeData.content === undefined && newNodeData.type === 'file') newNodeData.content = '';
    if (!isTemplateBeingCreated) delete newNodeData.templateType;
    if (isTemplateBeingCreated && newTemplateType === 'system') newNodeData.userId = null;
    const newDbNode = new File(newNodeData);
    await newDbNode.save();
    if (originalNode.type === 'folder') {
        const childrenToCopy = await File.find({ parentId: originalNode._id }).lean(); // Copy all children
        for (const child of childrenToCopy) {
            await copyVfsNodeRecursive(child._id, targetUserId, newDbNode._id, isTemplateBeingCreated, newTemplateType);
        }
    }
    return newDbNode;
}


// --- API Controllers ---

// @desc    Get all root VFS projects (non-templates) for the authenticated user
// @route   GET /api/vfs/projects
// @access  Private
export const getUserVfsProjects = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
        return res.status(401).json({ message: "Not authorized. User information missing." });
    }
    const userId = req.user._id;

    const projects = await File.find({
      userId: userId,
      parentId: null, // Root level items
      type: 'folder',
      isTemplate: false, // Specifically user projects, not their saved templates
    }).select('_id name createdAt updatedAt templateDetails.defaultEnvironment') // Include defaultEnv if stored
      .sort({ name: 1 })
      .lean();

    const formattedProjects = projects.map(p => ({
        _id: p._id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        defaultEnvironment: p.templateDetails?.defaultEnvironment || 'shell' // Default if not specified
    }));

    res.json(formattedProjects);
  } catch (error) {
    console.error('VFS_CTRL: Error fetching user VFS projects:', error);
    res.status(500).json({ message: 'Server error while fetching projects.', error: error.message });
  }
};

// @desc    Create a new VFS project (blank or from template)
// @route   POST /api/vfs/projects
// @access  Private
export const createNewVfsProject = async (req, res) => {
    try {
        if (!req.user || !req.user._id) return res.status(401).json({ message: "Not authorized." });
        const userId = req.user._id.toString();
        const { projectName, templateId } = req.body; // templateId is optional

        if (!projectName || typeof projectName !== 'string' || projectName.trim().length === 0) {
            return res.status(400).json({ message: 'Project name is required and must be a non-empty string.' });
        }
        const trimmedProjectName = projectName.trim();
        if (trimmedProjectName.includes('/') || trimmedProjectName.includes('\\') || trimmedProjectName.includes('..')) {
            return res.status(400).json({ message: 'Project name cannot contain path separators or ".." characters.'});
        }

        const existingProject = await File.findOne({ userId, name: trimmedProjectName, parentId: null, type: 'folder', isTemplate: false });
        if (existingProject) {
            return res.status(400).json({ message: `A project named "${trimmedProjectName}" already exists.` });
        }

        let newProjectRootVfsDoc;
        let defaultEnvironmentFromTemplate = 'shell'; // Default environment

        if (templateId) {
            const templateRootFolder = await File.findOne({ _id: templateId, isTemplate: true, type: 'folder' }).lean();
            if (!templateRootFolder) {
                return res.status(404).json({ message: 'Template not found or is invalid.' });
            }
            console.log(`VFS_CTRL: Creating project "${trimmedProjectName}" for user ${userId} from template "${templateRootFolder.name}" (ID: ${templateId})`);
            
            newProjectRootVfsDoc = await copyVfsNodeRecursive(
                templateRootFolder._id, 
                userId,                 // New owner
                null,                   // New parent is root
                false,                  // isTemplateBeingCreated = false (it's a user project)
                undefined,              // newTemplateType is not applicable
                trimmedProjectName      // Override root folder name
            );
            if (!newProjectRootVfsDoc) throw new Error("Failed to copy template structure into new project.");
            defaultEnvironmentFromTemplate = templateRootFolder.templateDetails?.defaultEnvironment || 'shell';

        } else {
            console.log(`VFS_CTRL: Creating new blank project "${trimmedProjectName}" for user ${userId}`);
            const newProject = new File({ userId, name: trimmedProjectName, type: 'folder', parentId: null, isTemplate: false });
            await newProject.save();
            newProjectRootVfsDoc = newProject.toObject(); // Convert to plain object for consistency
        }
        
        // Create corresponding host directory for the new project
        // The project's "slug" for the host filesystem is its VFS name
        const projectRootHostPath = path.resolve(BASE_PROJECT_DIR, userId, newProjectRootVfsDoc.name);
        if (!existsSync(projectRootHostPath)) {
            await fsPromises.mkdir(projectRootHostPath, { recursive: true });
            await fsPromises.chmod(projectRootHostPath, 0o755);
            console.log(`VFS_CTRL: Created host directory for new project: ${projectRootHostPath}`);
        }

        res.status(201).json({
            _id: newProjectRootVfsDoc._id,
            name: newProjectRootVfsDoc.name,
            type: newProjectRootVfsDoc.type,
            defaultEnvironment: defaultEnvironmentFromTemplate,
            createdAt: newProjectRootVfsDoc.createdAt,
            updatedAt: newProjectRootVfsDoc.updatedAt
        });

    } catch (error) {
        console.error('VFS_CTRL: Error creating new VFS project:', error);
        res.status(500).json({ message: 'Server error while creating project.', error: error.message });
    }
};

// @desc    Get all available templates (system + user's own)
// @route   GET /api/vfs/templates
// @access  Private
export const getAvailableTemplates = async (req, res) => {
    try {
        if (!req.user || !req.user._id) return res.status(401).json({ message: "Not authorized." });
        const userId = req.user._id;
        console.log("userid===>", userId);
        const systemTemplatesQuery = File.find({
            isTemplate: true,
            templateType: 'system',
            parentId: null,
            type: 'folder'
        }).select('_id name templateDetails').sort({ name: 1 }).lean();

        const userTemplatesQuery = File.find({
            userId: userId,
            isTemplate: true,
            templateType: 'user',
            parentId: null,
            type: 'folder'
        }).select('_id name templateDetails createdAt').sort({ name: 1 }).lean();

        const [systemTemplates, userTemplates] = await Promise.all([
            systemTemplatesQuery,
            userTemplatesQuery
        ]);

        const formatTemplate = (t, isSystem) => ({
            _id: t._id,
            name: t.name,
            description: t.templateDetails?.description || (isSystem ? "System Template" : "User Template"),
            icon: t.templateDetails?.icon,
            defaultEnvironment: t.templateDetails?.defaultEnvironment || 'shell',
            tags: t.templateDetails?.tags || [],
            isSystem: isSystem,
            createdAt: !isSystem ? t.createdAt : undefined // Only show createdAt for user templates
        });

        res.json({
            system: systemTemplates.map(t => formatTemplate(t, true)),
            user: userTemplates.map(t => formatTemplate(t, false))
        });

    } catch (error) { /* ... error handling ... */ }
};


// --- Helper to copy HOST FS structure to VFS (for saving user template) ---
async function copyHostToVfsRecursive(hostPath, targetUserId, targetVfsParentId, templateTypeForCopy, baseHostPathForSecurity) {
    const entries = await fsPromises.readdir(hostPath, { withFileTypes: true });
    for (const entry of entries) {
        const currentEntryHostPath = path.join(hostPath, entry.name);

        if (!currentEntryHostPath.startsWith(baseHostPathForSecurity)) {
            console.error(`SECURITY (Host->VFS Template): Path "${currentEntryHostPath}" outside base "${baseHostPathForSecurity}"`);
            continue;
        }
        if (['node_modules', '.git', '.DS_Store', '.vscode', '__pycache__', '.env', 'dist', 'build'].includes(entry.name) || entry.name.startsWith('~$')) {
             console.log(`  SKIPPING ignored host entry for template: ${entry.name}`);
            continue;
        }

        const vfsNodeData = {
            userId: targetUserId,
            name: entry.name,
            type: entry.isDirectory() ? 'folder' : 'file',
            parentId: targetVfsParentId,
            isTemplate: true, // It's being saved AS a template
            templateType: templateTypeForCopy,
            content: '',
        };
        if (entry.isFile()) {
            try {
                vfsNodeData.content = await fsPromises.readFile(currentEntryHostPath, 'utf8');
            } catch (readErr) {
                console.warn(`  WARN (Host->VFS Template): Could not read file ${currentEntryHostPath}, storing empty. ${readErr.message}`);
                vfsNodeData.content = `/* Error reading source file for template: ${entry.name} */`;
            }
        }
        
        const newVfsNode = new File(vfsNodeData);
        try {
            await newVfsNode.save();
            console.log(`  VFS_TEMPLATE_SAVE: Saved ${newVfsNode.type} "${newVfsNode.name}" to VFS template (Parent ID: ${targetVfsParentId})`);
            if (entry.isDirectory()) {
                await copyHostToVfsRecursive(currentEntryHostPath, targetUserId, newVfsNode._id, templateTypeForCopy, baseHostPathForSecurity);
            }
        } catch (saveErr) {
            console.error(`  VFS_TEMPLATE_SAVE: Error saving VFS entry for "${newVfsNode.name}": `, saveErr.message);
        }
    }
}


// @desc    User creates a new template from their active workspace
// @route   POST /api/vfs/user-templates
// @access  Private
export const createUserTemplate = async (req, res) => {
    try {
        if (!req.user || !req.user._id) return res.status(401).json({ message: "Not authorized." });
        const userId = req.user._id.toString();
        const { sourceProjectSlug, templateName, templateDetails } = req.body;

        if (!sourceProjectSlug || !templateName || !templateName.trim()) {
            return res.status(400).json({ message: "Source project slug and new template name are required." });
        }
        const trimmedTemplateName = templateName.trim();
        if (trimmedTemplateName.includes('/') || trimmedTemplateName.includes('\\') || trimmedTemplateName.includes('..')) {
            return res.status(400).json({ message: 'Template name cannot contain path separators or ".." characters.'});
        }

        const existingUserTemplate = await File.findOne({
            userId, name: trimmedTemplateName, parentId: null,
            type: 'folder', isTemplate: true, templateType: 'user'
        });
        if (existingUserTemplate) {
            return res.status(400).json({ message: `You already have a template named "${trimmedTemplateName}".` });
        }

        const sourceProjectHostPath = path.resolve(BASE_PROJECT_DIR, userId, sourceProjectSlug);
        if (!existsSync(sourceProjectHostPath) || !(await fsPromises.stat(sourceProjectHostPath)).isDirectory()) {
            return res.status(404).json({ message: `Source project workspace "${sourceProjectSlug}" not found on host or is not a directory.` });
        }

        const newTemplateRootVfs = new File({
            userId, name: trimmedTemplateName, type: 'folder', parentId: null,
            isTemplate: true, templateType: 'user',
            templateDetails: templateDetails || {}, 
        });
        await newTemplateRootVfs.save();
        console.log(`VFS_CTRL: Created VFS root for user template "${trimmedTemplateName}" (ID: ${newTemplateRootVfs._id})`);

        await copyHostToVfsRecursive(
            sourceProjectHostPath, userId, newTemplateRootVfs._id, 
            'user', sourceProjectHostPath
        );
            
        res.status(201).json({
            message: "Template created successfully from workspace.",
            template: {
                _id: newTemplateRootVfs._id, name: newTemplateRootVfs.name,
                templateDetails: newTemplateRootVfs.templateDetails,
            }
        });
    } catch (error) {
        console.error("VFS_CTRL: Error creating user template:", error);
        res.status(500).json({ message: "Failed to create user template.", error: error.message });
    }
};


// @desc    Share a VFS project (root folder) with another user
// @route   POST /api/vfs/projects/:projectId/share
// @access  Private (Only project owner can share)
export const shareVfsProject = async (req, res) => {
    try {
        const projectRootVfsId = req.params.projectId;
        const authenticatedUserId = req.user._id; // User performing the share action
        const { shareWithUserIdentifier, permission } = req.body; // e.g., email or username of target user

        if (!mongoose.Types.ObjectId.isValid(projectRootVfsId)) {
            return res.status(400).json({ message: "Invalid project ID format." });
        }
        if (!shareWithUserIdentifier) {
            return res.status(400).json({ message: "User identifier (email/username) to share with is required." });
        }
        if (!permission || !['read', 'write'].includes(permission)) {
            return res.status(400).json({ message: "Invalid permission level. Must be 'read' or 'write'." });
        }

        const project = await File.findById(projectRootVfsId);

        if (!project) {
            return res.status(404).json({ message: "Project not found." });
        }
        if (project.type !== 'folder' || project.parentId !== null) {
            return res.status(400).json({ message: "Can only share root project folders." });
        }
        if (project.userId.toString() !== authenticatedUserId.toString()) {
            return res.status(403).json({ message: "Forbidden: Only the project owner can share it." });
        }

        // Find the user to share with
        const userToShareWith = await User.findOne({ 
            $or: [{ email: shareWithUserIdentifier }, { username: shareWithUserIdentifier }] 
        });

        if (!userToShareWith) {
            return res.status(404).json({ message: `User "${shareWithUserIdentifier}" not found.` });
        }
        if (userToShareWith._id.toString() === authenticatedUserId.toString()) {
            return res.status(400).json({ message: "Cannot share a project with yourself." });
        }

        // Check if already shared with this user
        const existingShare = project.sharedWith.find(s => s.user.toString() === userToShareWith._id.toString());
        if (existingShare) {
            // Update permission if different
            if (existingShare.permission !== permission) {
                existingShare.permission = permission;
                await project.save();
                return res.json({ message: `Permissions updated for ${shareWithUserIdentifier} on project "${project.name}".` });
            } else {
                return res.status(400).json({ message: `Project already shared with ${shareWithUserIdentifier} with this permission.` });
            }
        }

        // Add new share information
        project.sharedWith.push({ user: userToShareWith._id, permission: permission });
        await project.save();

        console.log(`VFS_CTRL: User ${authenticatedUserId} shared project "${project.name}" (ID: ${project._id}) with user ${userToShareWith._id} (Permission: ${permission})`);
        res.json({ 
            message: `Project "${project.name}" shared successfully with ${shareWithUserIdentifier}.`,
            shareDetails: { userId: userToShareWith._id, username: userToShareWith.username, permission }
        });

    } catch (error) {
        console.error("VFS_CTRL: Error sharing project:", error);
        res.status(500).json({ message: "Server error while sharing project.", error: error.message });
    }
};


// @desc    List VFS projects shared with the authenticated user
// @route   GET /api/vfs/projects/shared-with-me
// @access  Private
export const getSharedVfsProjects = async (req, res) => {
    try {
        const authenticatedUserId = req.user._id;

        // Find root folders where the sharedWith array contains an entry for the current user
        const sharedProjects = await File.find({
            parentId: null,
            type: 'folder',
            isTemplate: false, // We are looking for actual projects shared
            "sharedWith.user": authenticatedUserId 
        })
        .populate('userId', 'username email') // Populate owner's info
        .select('_id name userId sharedWith createdAt updatedAt templateDetails.defaultEnvironment')
        .sort({ name: 1 })
        .lean();

        // Format the response to clearly show owner and the current user's permission
        const formattedSharedProjects = sharedProjects.map(p => {
            const shareInfo = p.sharedWith.find(s => s.user.toString() === authenticatedUserId.toString());
            return {
                _id: p._id,
                name: p.name,
                owner: { // Information about the project owner
                    _id: p.userId._id,
                    username: p.userId.username,
                    // email: p.userId.email // Optional
                },
                permissionForCurrentUser: shareInfo ? shareInfo.permission : 'unknown', // Should always be found by query
                createdAt: p.createdAt,
                updatedAt: p.updatedAt,
                defaultEnvironment: p.templateDetails?.defaultEnvironment || 'shell'
            };
        });
        
        res.json(formattedSharedProjects);

    } catch (error) {
        console.error("VFS_CTRL: Error fetching shared projects:", error);
        res.status(500).json({ message: "Server error while fetching shared projects.", error: error.message });
    }
};


// @desc    Stop sharing a VFS project with a specific user
// @route   DELETE /api/vfs/projects/:projectId/share/:targetUserId
// @access  Private (Only project owner can unshare)
export const unshareVfsProject = async (req, res) => {
    try {
        const { projectId, targetUserId } = req.params;
        const authenticatedUserId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(projectId) || !mongoose.Types.ObjectId.isValid(targetUserId)) {
            return res.status(400).json({ message: "Invalid project or user ID format." });
        }

        const project = await File.findById(projectId);
        if (!project) return res.status(404).json({ message: "Project not found." });
        if (project.type !== 'folder' || project.parentId !== null) {
            return res.status(400).json({ message: "Can only modify sharing on root project folders." });
        }
        if (project.userId.toString() !== authenticatedUserId.toString()) {
            return res.status(403).json({ message: "Forbidden: Only the project owner can modify sharing." });
        }

        const shareIndex = project.sharedWith.findIndex(s => s.user.toString() === targetUserId.toString());
        if (shareIndex === -1) {
            return res.status(404).json({ message: "Project is not currently shared with this user." });
        }

        project.sharedWith.splice(shareIndex, 1);
        await project.save();

        console.log(`VFS_CTRL: User ${authenticatedUserId} unshared project "${project.name}" from user ${targetUserId}`);
        res.json({ message: `Sharing removed for user ${targetUserId} from project "${project.name}".` });

    } catch (error) {
        console.error("VFS_CTRL: Error unsharing project:", error);
        res.status(500).json({ message: "Server error while unsharing project.", error: error.message });
    }
};