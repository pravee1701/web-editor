import { promises as fsPromises, existsSync } from 'fs';
import path from 'path';
import { syncProjectFromVfsToHost, syncWorkspaceToVfs } from './codeExecutionController.js'; 
import { checkProjectPermission } from '../utils/authUtils.js';

const BASE_PROJECT_DIR = path.resolve(process.cwd(), 'projects');


const resolveUserProjectPath = (userId, projectSlug, relativePathWithinProject) => {
  if (!userId) throw new Error('User ID is required for path resolution.');
  if (!projectSlug) throw new Error('Project slug is required for path resolution.');
  
  if (relativePathWithinProject === undefined || relativePathWithinProject === null) {
    relativePathWithinProject = ''; // Default to project root if path is empty/null
  }

  // The root directory for this specific project on the host
  const specificProjectRootOnHost = path.resolve(BASE_PROJECT_DIR, userId.toString(), projectSlug.toString());
  
  // The path received from client (relativePathWithinProject) should be relative *within* this project.
  // Remove any leading slash as path.resolve will handle it correctly when joining with an absolute base.
  const cleanRelativePath = relativePathWithinProject.toString().replace(/^\//, '');
  
  const fullHostPath = path.resolve(specificProjectRootOnHost, cleanRelativePath);

  // Security check: Ensure the resolved path is within the specific project's root directory
  if (!fullHostPath.startsWith(specificProjectRootOnHost) && fullHostPath !== specificProjectRootOnHost) {
    // Allow being exactly the project root (e.g. when relativePath is "" or "/")
    throw new Error(
      `Access Denied: Path traversal attempt. User: ${userId}, Project: "${projectSlug}", Relative Path: "${relativePathWithinProject}", Resolved: "${fullHostPath}"`
    );
  }
  return fullHostPath;
};

export const listFiles = async (req, res) => {
  try {
    const loggedInUserId = req.user._id.toString();
    const projectOwnerId = req.query.userId; 

    console.log("loggedInUserId and projectOwnerId ====>", loggedInUserId, projectOwnerId);
    const projectSlug = req.query.projectSlug;
    const relativePathInProject = req.query.path || ''; // Path within the projectSlug

    if (!projectOwnerId || !projectSlug) {
      return res.status(400).json({ message: "userId (owner) and projectSlug query parameters are required." });
    }

    if (!await checkProjectPermission(loggedInUserId, projectOwnerId, projectSlug, 'read')) {
      return res.status(403).json({ message: "Forbidden: You don't have permission to view this project's files." });
    }

    const fullHostPathToList = resolveUserProjectPath(projectOwnerId, projectSlug, relativePathInProject);
    console.log(`FS_CTRL: listFiles - Listing: ${fullHostPathToList}`);

    if (!existsSync(fullHostPathToList)) {
      console.warn(`FS_CTRL: listFiles - Path not found on host: ${fullHostPathToList}`);
      return res.json([]); 
    }
    if (!(await fsPromises.stat(fullHostPathToList)).isDirectory()) {
        return res.status(400).json({ message: "Target path is not a directory."});
    }

    const entries = await fsPromises.readdir(fullHostPathToList, { withFileTypes: true });
    const files = entries
      .map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'folder' : 'file',
        path: path.posix.join('/', relativePathInProject, entry.name) // Path relative to projectSlug root for client
      }))
      .filter(f => !['.git', 'node_modules', '.DS_Store', '.vscode', '__pycache__'].includes(f.name) && !f.name.startsWith('~$'));
    
      console.log(`FS_CTRL: listFiles - Files found: ${files}`);
    res.json(files);
  } catch (error) {
    console.error('FS_CTRL: Error listing files:', error);
    if (error.message.startsWith('Access Denied')) return res.status(403).json({ message: error.message });
    res.status(500).json({ message: 'Failed to list files.', error: error.message });
  }
};

export const readFileContent = async (req, res) => {
  try {
    const loggedInUserId = req.user._id.toString();
    const projectOwnerId = req.query.userId;
    const projectSlug = req.query.projectSlug;
    const relativePathInProject = req.query.path;

    if (!projectOwnerId || !projectSlug || !relativePathInProject) {
      return res.status(400).json({ message: "userId (owner), projectSlug, and path query parameters are required." });
    }

    if (!await checkProjectPermission(loggedInUserId, projectOwnerId, projectSlug, 'read')) {
      return res.status(403).json({ message: "Forbidden: You don't have permission to read this file." });
    }
    
    const fullHostPath = resolveUserProjectPath(projectOwnerId, projectSlug, relativePathInProject);
    console.log(`FS_CTRL: readFileContent - Reading: ${fullHostPath}`);

    if (!existsSync(fullHostPath) || (await fsPromises.stat(fullHostPath)).isDirectory()) {
      return res.status(404).json({ message: 'File not found or is a directory.' });
    }
    const content = await fsPromises.readFile(fullHostPath, 'utf8');
    res.json({ content });
  } catch (error) { 
    console.error('FS_CTRL: Error reading file:', error);
    if (error.message.startsWith('Access Denied')) return res.status(403).json({ message: error.message });
    res.status(500).json({ message: 'Failed to read file.', error: error.message });
  }
};

export const writeFileContent = async (req, res) => {
  try {
    const loggedInUserId = req.user._id.toString();
    const projectOwnerId = req.query.userId;
    const projectSlug = req.query.projectSlug;
    const relativePathInProject = req.query.path;
    const { content } = req.body;

    if (!projectOwnerId || !projectSlug || !relativePathInProject || content === undefined) {
      return res.status(400).json({ message: "userId (owner), projectSlug, path, and content are required." });
    }

    if (!await checkProjectPermission(loggedInUserId, projectOwnerId, projectSlug, 'write')) {
      return res.status(403).json({ message: "Forbidden: You don't have permission to write to this file." });
    }

    const fullHostPath = resolveUserProjectPath(projectOwnerId, projectSlug, relativePathInProject);
    console.log(`FS_CTRL: writeFileContent - Writing to: ${fullHostPath}`);
    const dirPath = path.dirname(fullHostPath);

    if (!existsSync(dirPath)) {
      await fsPromises.mkdir(dirPath, { recursive: true });
      await fsPromises.chmod(dirPath, 0o755);
    }
    await fsPromises.writeFile(fullHostPath, content, 'utf8');
    await fsPromises.chmod(fullHostPath, 0o644);
    res.json({ message: 'File saved successfully.' });
  } catch (error) { 
    console.error('FS_CTRL: Error writing file:', error);
    if (error.message.startsWith('Access Denied')) return res.status(403).json({ message: error.message });
    res.status(500).json({ message: 'Failed to write file.', error: error.message });
  }
};

export const createDirectory = async (req, res) => {
  try {
    const loggedInUserId = req.user._id.toString();
    const projectOwnerId = req.body.userId || req.query.userId; // Allow userId in body or query
    const projectSlug = req.body.projectSlug || req.query.projectSlug;
    const { path: relativePathInProject } = req.body;

    if (!projectOwnerId || !projectSlug || !relativePathInProject) return res.status(400).json({ message: "Owner userId, projectSlug, and path are required."});
    
    if (!await checkProjectPermission(loggedInUserId, projectOwnerId, projectSlug, 'write')) {
      return res.status(403).json({ message: "Forbidden: You don't have permission to create directories in this project." });
    }

    const fullHostPath = resolveUserProjectPath(projectOwnerId, projectSlug, relativePathInProject);
    console.log(`FS_CTRL: createDirectory - Creating: ${fullHostPath}`);
    if (existsSync(fullHostPath)) {
      return res.status(400).json({ message: 'Directory or file already exists.' });
    }
    await fsPromises.mkdir(fullHostPath, { recursive: true }); 
    await fsPromises.chmod(fullHostPath, 0o755);
    res.status(201).json({ message: 'Directory created successfully.' });
  } catch (error) { 
    console.error('FS_CTRL: Error creating directory:', error);
    if (error.message.startsWith('Access Denied')) return res.status(403).json({ message: error.message });
    res.status(500).json({ message: 'Failed to create directory.', error: error.message });
  }
};

export const deleteItem = async (req, res) => {
    try {
      const loggedInUserId = req.user._id.toString();
      const projectOwnerId = req.query.userId;
      const projectSlug = req.query.projectSlug;
      const relativePathInProject = req.query.path;
  
      if (!projectOwnerId || !projectSlug || !relativePathInProject) {
        return res.status(400).json({ message: "userId (owner), projectSlug, and path query parameters are required." });
      }
  
      if (!await checkProjectPermission(loggedInUserId, projectOwnerId, projectSlug, 'read')) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to read this file." });
      }

        const fullHostPath = resolveUserProjectPath(projectOwnerId, projectSlug, relativePathInProject);
        console.log(`FS_CTRL: deleteItem - Deleting: ${fullHostPath}`);
        if (!existsSync(fullHostPath)) return res.status(404).json({ message: 'Item not found.' });
        
        const specificProjectRootOnHost = path.resolve(BASE_PROJECT_DIR, projectOwnerId, projectSlug);
        if (fullHostPath === specificProjectRootOnHost && (relativePathInProject === '/' || relativePathInProject === '')) {
            return res.status(400).json({ message: 'Cannot delete project root via this item endpoint.' });
        }

        await fsPromises.rm(fullHostPath, { recursive: true, force: true });
        res.json({ message: 'Item deleted successfully.' });
    } catch (error) { 
        console.error('FS_CTRL: Error deleting item:', error);
        if (error.message.startsWith('Access Denied')) return res.status(403).json({ message: error.message });
        res.status(500).json({ message: 'Failed to delete item.', error: error.message });
    }
};

export const renameItem = async (req, res) => {
    try {
      const loggedInUserId = req.user._id.toString();
      const projectOwnerId = req.query.userId;
      const projectSlug = req.query.projectSlug;
      const relativePathInProject = req.query.path;
      const { oldPath, newName } = req.body;
  
      if (!projectOwnerId || !projectSlug || !relativePathInProject) {
        return res.status(400).json({ message: "userId (owner), projectSlug, and path query parameters are required." });
      }
  
      if (!await checkProjectPermission(loggedInUserId, projectOwnerId, projectSlug, 'read')) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to read this file." });
      }
        if (!oldPath || !newName) return res.status(400).json({ message: 'Old path and new name are required.' });
        const trimmedNewName = newName.trim();
        if (trimmedNewName.includes('/') || trimmedNewName.includes('\\') || trimmedNewName.includes('..')) {
            return res.status(400).json({ message: 'New name cannot contain path separators or ".." characters.' });
        }

        const fullOldHostPath = resolveUserProjectPath(projectOwnerId, projectSlug, oldPath);
        if (!existsSync(fullOldHostPath)) return res.status(404).json({ message: 'Item to rename not found.' });

        const parentDirOfOld = path.dirname(fullOldHostPath);
        const fullNewHostPath = path.join(parentDirOfOld, trimmedNewName);
        console.log(`FS_CTRL: renameItem - Renaming: ${fullOldHostPath} to ${fullNewHostPath}`);

        // resolveUserProjectPath includes security check for oldPath.
        // New path security check: ensure it's still within the same project root.
        const specificProjectRootOnHost = path.resolve(BASE_PROJECT_DIR, projectOwnerId, projectSlug);
        if (!fullNewHostPath.startsWith(specificProjectRootOnHost)) {
           throw new Error(`Access Denied: New path for rename ("${fullNewHostPath}") is outside project directory "${specificProjectRootOnHost}".`);
        }
        if (existsSync(fullNewHostPath)) return res.status(400).json({ message: `An item named "${trimmedNewName}" already exists.` });

        await fsPromises.rename(fullOldHostPath, fullNewHostPath);
        res.json({ message: 'Item renamed successfully.' });
    } catch (error) { 
        console.error('FS_CTRL: Error renaming item:', error);
        if (error.message.startsWith('Access Denied')) return res.status(403).json({ message: error.message });
        res.status(500).json({ message: 'Failed to rename item.', error: error.message });
    }
};

export const moveItem = async (req, res) => {
    try {
      const loggedInUserId = req.user._id.toString();
      const projectOwnerId = req.query.userId;
      const projectSlug = req.query.projectSlug;
      const relativePathInProject = req.query.path;
      const { oldPath, newPath } = req.body; 
  
      if (!projectOwnerId || !projectSlug || !relativePathInProject) {
        return res.status(400).json({ message: "userId (owner), projectSlug, and path query parameters are required." });
      }
  
      if (!await checkProjectPermission(loggedInUserId, projectOwnerId, projectSlug, 'read')) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to read this file." });
      }
        if (!oldPath || !newPath) return res.status(400).json({ message: 'Old path and new path are required.' });

        const fullOldHostPath = resolveUserProjectPath(projectOwnerId, projectSlug, oldPath);
        // For newPath, it's also relative to the same projectSlug
        const fullNewHostPath = resolveUserProjectPath(projectOwnerId, projectSlug, newPath); 
        console.log(`FS_CTRL: moveItem - Moving: ${fullOldHostPath} to ${fullNewHostPath}`);

        if (!existsSync(fullOldHostPath)) return res.status(404).json({ message: 'Item to move not found.' });
        if (existsSync(fullNewHostPath)) return res.status(400).json({ message: 'Target path already exists.' });
        
        const newParentDir = path.dirname(fullNewHostPath);
        if (!existsSync(newParentDir)) {
            await fsPromises.mkdir(newParentDir, { recursive: true });
            await fsPromises.chmod(newParentDir, 0o755);
        }

        await fsPromises.rename(fullOldHostPath, fullNewHostPath);
        res.json({ message: 'Item moved successfully.' });
    } catch (error) {
        console.error('FS_CTRL: Error moving item:', error);
        if (error.message.startsWith('Access Denied')) return res.status(403).json({ message: error.message });
        res.status(500).json({ message: 'Failed to move item.', error: error.message });
    }
};

// --- Sync Triggers ---
export const triggerVfsToHostSync = async (req, res) => {
    console.log("FS_CTRL: TRIGGER_VFS_TO_HOST: Entered");
    try {
      const loggedInUserId = req.user._id.toString();
      const { vfsProjectId, projectSlug, userId: projectOwnerIdFromBody } = req.body; 

        console.log("FS_CTRL: TRIGGER_VFS_TO_HOST: req.user:", projectOwnerIdFromBody);
        console.log("FS_CTRL: TRIGGER_VFS_TO_HOST: req.body:", req.body);

        if (vfsProjectId !== null && (typeof vfsProjectId !== 'string' || vfsProjectId.trim() === '')) {
             if (vfsProjectId !== undefined ) {
                console.error("FS_CTRL: TRIGGER_VFS_TO_HOST: Validation failed - vfsProjectId invalid.");
                return res.status(400).json({ message: "vfsProjectId is invalid. Must be a valid ID string or null." });
            }
        }
        if (!projectOwnerIdFromBody || !projectSlug || (vfsProjectId === undefined && vfsProjectId !== null)) {
          return res.status(400).json({ message: "userId (owner), projectSlug, and vfsProjectId (or null) are required." });
      }

      if (!await checkProjectPermission(loggedInUserId, projectOwnerIdFromBody, projectSlug, 'write')) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to sync this project from VFS." });
      }
        
        // projectSlug from client IS the effectiveProjectSlug for host path construction
        const projectRootHostPath = path.resolve(BASE_PROJECT_DIR, projectOwnerIdFromBody, projectSlug.trim());

        console.log(`FS_CTRL: TRIGGER_VFS_TO_HOST: Calling sync. User: ${projectOwnerIdFromBody}, VFS ID: ${vfsProjectId}, Host Path: ${projectRootHostPath}`);
        await syncProjectFromVfsToHost(projectOwnerIdFromBody, vfsProjectId, projectRootHostPath);
        
        res.json({ message: `Project ${projectSlug.trim()} synced from VFS to host workspace.` });
    } catch (error) { 
        console.error('FS_CTRL: Error triggering VFS to Host Sync:', error);
        if (error.message.toLowerCase().includes("required") || error.message.toLowerCase().includes("invalid")) {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to sync project to workspace.', error: error.message });
    }
};

export const triggerHostToVfsSync = async (req, res) => {
    console.log("FS_CTRL: TRIGGER_HOST_TO_VFS: Entered");
    try {
      const loggedInUserId = req.user._id.toString();
      const { vfsProjectId, projectSlug, userId: projectOwnerIdFromBody } = req.body;

      if (vfsProjectId !== null && (typeof vfsProjectId !== 'string' || vfsProjectId.trim() === '')) {
        if (vfsProjectId !== undefined ) {
           console.error("FS_CTRL: TRIGGER_HOST_TO_VFS: Validation failed - vfsProjectId invalid.");
           return res.status(400).json({ message: "vfsProjectId is invalid. Must be a valid ID string or null." });
       }
      }

      if (!projectOwnerIdFromBody || !projectSlug || (vfsProjectId === undefined && vfsProjectId !== null)) {
          return res.status(400).json({ message: "userId (owner), projectSlug, and vfsProjectId (or null) are required." });
      }
      if (!await checkProjectPermission(loggedInUserId, projectOwnerIdFromBody, projectSlug, 'write')) {
           return res.status(403).json({ message: "Forbidden: You don't have permission to save this workspace to VFS." });
      }

       
        
        const projectRootHostPath = path.resolve(BASE_PROJECT_DIR, projectOwnerIdFromBody, projectSlug.trim());

        console.log(`FS_CTRL: TRIGGER_HOST_TO_VFS: Calling sync. User: ${projectOwnerIdFromBody}, Host Path: ${projectRootHostPath}, VFS ID: ${vfsProjectId}`);
        await syncWorkspaceToVfs(projectOwnerIdFromBody, projectRootHostPath, vfsProjectId);
        res.json({ message: `Workspace ${projectSlug.trim()} synced to VFS.` });
    } catch (error) { 
        console.error('FS_CTRL: Error triggering Host to VFS Sync:', error);
        if (error.message.toLowerCase().includes("required") || error.message.toLowerCase().includes("invalid")) {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to sync workspace to VFS.', error: error.message });
    }
};