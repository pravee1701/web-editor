import { executeCommandInContainer } from './dockerController.js';
import File from '../models/fileModel.js';
import path from 'path';
import { promises as fsPromises, existsSync } from 'fs';

const BASE_PROJECT_DIR = path.resolve(process.cwd(), 'projects');

// --- VFS to Host Sync ---
async function getVfsDescendants(userId, parentId) {
    const items = await File.find({ userId, parentId }).lean(); // Use .lean() for plain JS objects
    const children = [];
    for (const item of items) {
        const child = {
            name: item.name, type: item.type, _id: item._id,
            content: item.type === 'file' ? (item.content || '') : undefined,
        };
        if (item.type === 'folder') {
            child.children = await getVfsDescendants(userId, item._id);
        }
        children.push(child);
    }
    return children;
}

async function createHostFilesRecursive(items, currentHostPath, baseHostPathForSecurityCheck) {
    for (const item of items) {
        const itemHostPath = path.join(currentHostPath, item.name);
        if (!itemHostPath.startsWith(baseHostPathForSecurityCheck)) {
            console.error(`SECURITY ALERT (VFS->Host): Attempt to write to "${itemHostPath}" outside base "${baseHostPathForSecurityCheck}"`);
            continue;
        }
        if (item.type === 'folder') {
            if (!existsSync(itemHostPath)) {
                await fsPromises.mkdir(itemHostPath, { recursive: true });
                await fsPromises.chmod(itemHostPath, 0o755);
            }
            if (item.children && item.children.length > 0) {
                await createHostFilesRecursive(item.children, itemHostPath, baseHostPathForSecurityCheck);
            }
        } else { // file
            await fsPromises.writeFile(itemHostPath, item.content || '');
            await fsPromises.chmod(itemHostPath, 0o644);
        }
    }
}

export const syncProjectFromVfsToHost = async (userId, vfsProjectRootFolderId, projectRootHostPath) => {
    console.log(`CODE_EXEC: SYNC_VFS_TO_HOST: User ${userId}, VFS Root ID ${vfsProjectRootFolderId}, Host Path ${projectRootHostPath}`);
    if (vfsProjectRootFolderId === undefined) { // Allow null for user's VFS root, but not undefined
        throw new Error("VFS Project Root Folder ID is required (can be null for user's VFS root).");
    }
     if (!existsSync(projectRootHostPath)) {
        console.log(`CODE_EXEC: SYNC_VFS_TO_HOST: Creating project root host path: ${projectRootHostPath}`);
        await fsPromises.mkdir(projectRootHostPath, { recursive: true });
        await fsPromises.chmod(projectRootHostPath, 0o755);
    }
    const vfsStructure = await getVfsDescendants(userId, vfsProjectRootFolderId); // null for user's VFS root
    await createHostFilesRecursive(vfsStructure, projectRootHostPath, projectRootHostPath);
    console.log(`CODE_EXEC: SYNC_VFS_TO_HOST: Sync complete for ${projectRootHostPath}`);
};


// --- Host to VFS Sync ---
async function recursivelyScanHostAndUploadToVFS(userId, currentHostDir, vfsParentId, projectRootHostPathForSecurity) {
    const entries = await fsPromises.readdir(currentHostDir, { withFileTypes: true });
    for (const entry of entries) {
        const hostEntryPath = path.join(currentHostDir, entry.name);
        if (['node_modules', '.git', '.DS_Store', '.env', '.vscode'].includes(entry.name) || entry.name.startsWith('__pycache__')) {
            continue;
        }
        if (!hostEntryPath.startsWith(projectRootHostPathForSecurity)) {
             console.error(`SECURITY ALERT (Host->VFS): Attempt to read from "${hostEntryPath}" outside base "${projectRootHostPathForSecurity}"`);
             continue;
        }
        let vfsItem = await File.findOne({ userId, name: entry.name, parentId: vfsParentId });
        if (entry.isDirectory()) {
            const expectedType = 'folder';
            if (vfsItem && vfsItem.type !== expectedType) { await File.deleteOne({ _id: vfsItem._id }); vfsItem = null; }
            if (!vfsItem) {
                vfsItem = new File({ userId, name: entry.name, type: expectedType, parentId: vfsParentId, updatedAt: new Date() });
                await vfsItem.save();
            }
            await recursivelyScanHostAndUploadToVFS(userId, hostEntryPath, vfsItem._id, projectRootHostPathForSecurity);
        } else if (entry.isFile()) {
            const expectedType = 'file';
             if (vfsItem && vfsItem.type !== expectedType) { await File.deleteOne({ _id: vfsItem._id }); vfsItem = null; }
            const content = await fsPromises.readFile(hostEntryPath, 'utf8');
            if (vfsItem) {
                if (vfsItem.content !== content) {
                    vfsItem.content = content; vfsItem.updatedAt = new Date(); await vfsItem.save();
                } else if ( (new Date().getTime() - vfsItem.updatedAt.getTime()) > 1000 ) { // Touch updatedAt if file unchanged but sync is called
                    vfsItem.updatedAt = new Date(); await vfsItem.save();
                }
            } else {
                vfsItem = new File({ userId, name: entry.name, type: expectedType, parentId: vfsParentId, content, updatedAt: new Date() });
                await vfsItem.save();
            }
        }
    }
}

export const syncWorkspaceToVfs = async (userId, projectRootHostPath, vfsProjectRootFolderId) => {
    console.log(`CODE_EXEC: SYNC_HOST_TO_VFS: User ${userId}, Host Path ${projectRootHostPath}, VFS Project ID ${vfsProjectRootFolderId}`);
    if (!existsSync(projectRootHostPath)) {
        console.error(`CODE_EXEC: SYNC_HOST_TO_VFS: Host path ${projectRootHostPath} does not exist.`);
        return;
    }
    // vfsProjectRootFolderId is the _id of the folder in VFS representing the project root, or null for user's VFS root.
    await recursivelyScanHostAndUploadToVFS(userId, projectRootHostPath, vfsProjectRootFolderId, projectRootHostPath);
    console.log(`CODE_EXEC: SYNC_HOST_TO_VFS: Sync complete for ${projectRootHostPath}`);
};

// --- Script/Command Execution (for non-PTY scenarios or helper scripts) ---
// getFileContent from VFS (if script isn't on host yet)
const getFileContentFromVfs = async (userId, vfsFullFilePath) => { /* ... same as your getFileContent ... */ 
    const pathParts = vfsFullFilePath.split('/').filter(Boolean);
    const fileName = pathParts.pop();
    let parentId = null;
    if (vfsFullFilePath === '/' && !fileName) throw new Error("Cannot get content of root directory as a file.");
    if (!fileName && pathParts.length === 0 && vfsFullFilePath !== '/') {
        const fileAtRoot = await File.findOne({ userId, name: vfsFullFilePath, parentId: null, type: 'file' });
        if (!fileAtRoot) throw new Error(`File not found at VFS root: ${vfsFullFilePath}`);
        return fileAtRoot.content;
    }
    for (const part of pathParts) {
        const folder = await File.findOne({ userId, name: part, type: 'folder', parentId });
        if (!folder) throw new Error(`Folder not found in VFS path: ${part} of ${vfsFullFilePath}`);
        parentId = folder._id;
    }
    const file = await File.findOne({ userId, name: fileName, parentId, type: 'file' });
    if (!file) throw new Error(`File not found in VFS: ${vfsFullFilePath} (filename: ${fileName}, parentId: ${parentId})`);
    return file.content;
};

const getLanguageCommand = (fileName, language) => { /* ... same as your getLanguageCommand ... */ 
    const safeFileName = fileName.replace(/(["'$`\\])/g, '\\$1');
    const commands = {
        javascript: `node "${safeFileName}"`, python: `python "${safeFileName}"`,
        cpp: `g++ "${safeFileName}" -o "${safeFileName.replace(/\.cpp$/, '')}" && ./"${safeFileName.replace(/\.cpp$/, '')}"`,
        java: `javac "${safeFileName}" && java "${safeFileName.replace(/\.java$/, '')}"`,
        php: `php "${safeFileName}"`, ruby: `ruby "${safeFileName}"`,
    };
    return commands[language.toLowerCase()] || `node "${safeFileName}"`;
};

export const runScript = async (userId, terminalId, projectSlug, vfsPathToScript, language = 'javascript') => {
  // vfsPathToScript is relative to VFS root, e.g., "/MyProject/src/index.js"
  // projectSlug is the name of the project folder on host, e.g., "MyProject" or userId for root
  
  const pathPartsVfs = vfsPathToScript.split('/').filter(Boolean);
  if (pathPartsVfs.length === 0) throw new Error("Invalid vfsPathToScript for runScript.");

  const vfsProjectNameFromFilePath = pathPartsVfs[0];
  // Ensure projectSlug consistency or choose one source of truth for project name
  const effectiveProjectSlug = projectSlug || vfsProjectNameFromFilePath || userId.toString();

  const relativePathInProject = projectSlug ? 
                                vfsPathToScript.replace(new RegExp(`^/${projectSlug}/?`), '') : // Path relative to projectSlug
                                (vfsPathToScript.startsWith('/') ? vfsPathToScript.substring(1) : vfsPathToScript); // Path relative to user root

  const fileName = path.basename(vfsPathToScript);
  const projectRootHostPath = path.resolve(BASE_PROJECT_DIR, userId.toString(), effectiveProjectSlug);
  const scriptHostPath = path.join(projectRootHostPath, relativePathInProject);

  if (!existsSync(scriptHostPath)) {
    console.warn(`CODE_EXEC: RUN_SCRIPT: Script ${scriptHostPath} not on host. Fetching from VFS path ${vfsPathToScript}...`);
    try {
        const content = await getFileContentFromVfs(userId, vfsPathToScript);
        if (content === null) throw new Error(`File ${vfsPathToScript} not found in VFS.`);
        const scriptHostDir = path.dirname(scriptHostPath);
        if(!existsSync(scriptHostDir)) {
            await fsPromises.mkdir(scriptHostDir, {recursive: true}); await fsPromises.chmod(scriptHostDir, 0o755);
        }
        await fsPromises.writeFile(scriptHostPath, content); await fsPromises.chmod(scriptHostPath, 0o644);
        console.log(`CODE_EXEC: RUN_SCRIPT: Wrote script from VFS to ${scriptHostPath}`);
    } catch (vfsError) {
        throw new Error(`Script not found on host (${scriptHostPath}) and VFS lookup failed: ${vfsError.message}`);
    }
  }
  
  const command = getLanguageCommand(fileName, language);
  const containerWorkingDir = path.posix.join('/workspace', path.dirname(relativePathInProject));

  console.log(`CODE_EXEC: RUN_SCRIPT: User ${userId}, Lang ${language}, Cmd "${command}", WD "${containerWorkingDir}" (Host: ${scriptHostPath})`);
  return executeCommandInContainer(userId, terminalId, command, {
    workingDir: containerWorkingDir,
    includeError: true,
    language: language,
    projectSlug: effectiveProjectSlug, // Pass project context for container creation if needed
    // vfsProjectId: could also be passed if known and relevant for container creation options
  });
};

export const installPackages = async (userId, terminalId, commandArgs, projectSlug, relativeCwd = '') => {
    const cmd = Array.isArray(commandArgs) ? commandArgs.join(' ') : commandArgs;
    const fullCommand = `npm ${cmd}`;
    const containerWorkingDir = path.posix.join('/workspace', relativeCwd); // /workspace maps to projects/<userId>/<projectSlug>
    console.log(`CODE_EXEC: NPM_INSTALL: User ${userId}, Project ${projectSlug}, WD ${containerWorkingDir}, Cmd: ${fullCommand}`);
    return executeCommandInContainer(userId, terminalId, fullCommand, {
        workingDir: containerWorkingDir, includeError: true, language: 'node', projectSlug,
    });
};

export const startDevServer = async (userId, terminalId, framework, projectSlug, relativeCwd = '') => {
    const commands = { react: 'npm start', vue: 'npm run serve', angular: 'npm run start', express: 'node index.js || node server.js || node app.js' };
    const command = commands[framework.toLowerCase()] || 'npm start';
    const containerWorkingDir = path.posix.join('/workspace', relativeCwd);
    console.log(`CODE_EXEC: START_DEV_SERVER: User ${userId}, Project ${projectSlug}, Framework ${framework}, WD ${containerWorkingDir}`);
    return executeCommandInContainer(userId, terminalId, command, {
        workingDir: containerWorkingDir, includeError: true, language: framework, projectSlug,
    });
};