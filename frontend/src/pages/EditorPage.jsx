import React, { useState, useEffect, useCallback, useRef } from 'react';
import Split from 'react-split';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import path from 'path-browserify';

import Editor from '../components/Editor';
import CollaborativeEditor from '../components/CollaborativeEditor';
import FileTree from '../components/FileTree';
import TerminalComponent from '../components/Terminal';
import ProjectSelector from '../components/ProjectSelector';
import ShareProjectModal from '../components/ShareProjectModal'; // Assuming this is created
import axios from '../utils/axios';
import {
  FaSpinner, FaExchangeAlt, FaCloudUploadAlt, FaCloudDownloadAlt,
  FaPlusSquare, FaCode, FaFileCode, FaUsers, FaUserSlash, FaShareAlt
} from 'react-icons/fa';

const GlobalSpinner = ({ message = "Loading..." }) => (
  <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
    <FaSpinner className="animate-spin h-10 w-10 text-blue-500 mr-4" />
    <span className="text-lg">{message}</span>
  </div>
);


const SaveAsTemplateModal = ({ isActive, onClose, onSave, currentProjectName, currentProjectEnv }) => {
  const [templateName, setTemplateName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [defaultEnvironment, setDefaultEnvironment] = useState('shell');

  useEffect(() => {
    if (isActive) {
      setTemplateName(currentProjectName ? `${currentProjectName} Template` : 'New Template');
      setDefaultEnvironment(currentProjectEnv || 'shell');
      setDescription('');
      setTags('');
    }
  }, [isActive, currentProjectName, currentProjectEnv]);

  if (!isActive) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!templateName.trim()) {
      alert("Template name is required.");
      return;
    }
    onSave({
      name: templateName.trim(),
      details: {
        description: description.trim(),
        tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
        defaultEnvironment: defaultEnvironment
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4 transition-opacity duration-300 ease-in-out animate-fadeIn">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md text-white border border-gray-700 transform transition-all duration-300 ease-in-out scale-100 animate-slideUp">
        <h2 className="text-xl font-semibold mb-6 text-center text-gray-100">Save Project as Template</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="templateNameModal" className="block text-sm font-medium text-gray-300 mb-1">Template Name:</label>
            <input id="templateNameModal" type="text" value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="w-full p-2.5 rounded-md bg-gray-700 border border-gray-600 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" required autoFocus />
          </div>
          <div>
            <label htmlFor="templateDescModal" className="block text-sm font-medium text-gray-300 mb-1">Description (Optional):</label>
            <textarea id="templateDescModal" value={description} onChange={(e) => setDescription(e.target.value)} rows="2" className="w-full p-2.5 rounded-md bg-gray-700 border border-gray-600 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label htmlFor="templateTagsModal" className="block text-sm font-medium text-gray-300 mb-1">Tags (comma-separated, Optional):</label>
            <input id="templateTagsModal" type="text" value={tags} onChange={(e) => setTags(e.target.value)} className="w-full p-2.5 rounded-md bg-gray-700 border border-gray-600 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label htmlFor="templateEnvModal" className="block text-sm font-medium text-gray-300 mb-1">Default Environment for Terminals:</label>
            <div className="relative">
              <select id="templateEnvModal" value={defaultEnvironment} onChange={(e) => setDefaultEnvironment(e.target.value)} className="w-full p-2.5 appearance-none rounded-md bg-gray-700 border border-gray-600 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none cursor-pointer">
                <option value="shell">Generic Shell</option><option value="javascript">JavaScript (Node)</option><option value="python">Python</option><option value="java">Java</option><option value="cpp">C++</option>
              </select>
              <FaCaretDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md bg-gray-600 hover:bg-gray-500 text-gray-200 transition-colors">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm rounded-md bg-green-600 hover:bg-green-700 text-white transition-colors">Save Template</button>
          </div>
        </form>
      </div>
    </div>
  );
};


const EditorPage = () => {
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [editorLanguage, setEditorLanguage] = useState('plaintext');
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSaveAsTemplateModal, setShowSaveAsTemplateModal] = useState(false);
  const [isCollabMode, setIsCollabMode] = useState(false); // Default to collab on
  const [showShareModal, setShowShareModal] = useState(false);
  const [projectToShare, setProjectToShare] = useState(null); // Stores VFS project data for sharing modal

  const { user: loggedInUser, isLoadingSession: isAuthSessionLoading } = useSelector((state) => state.auth);
  const currentLoggedInUserId = loggedInUser?._id;

  const [activeProjectContext, setActiveProjectContext] = useState({
    currentLoggedInUserId: null,
    ownerUserId: null,
    ownerUsername: null,
    slug: null,
    vfsId: null,
    currentUserPermission: 'read',
    currentVfsPathForTerminal: '/',
    defaultPtyEnvironment: 'shell',
    isLoadedAndSynced: false,
  });

  const sessionSyncedProjectsRef = useRef(new Set()); 
  const activeYDocRef = useRef(null);
  const setActiveYDoc = useCallback((ydoc) => { activeYDocRef.current = ydoc; }, []);

  useEffect(() => {
    if (currentLoggedInUserId && activeProjectContext.currentLoggedInUserId !== currentLoggedInUserId) {
     setActiveProjectContext(prev => ({
        ...prev, // Keep potentially loaded slug/vfsId if any, but they will be re-evaluated
        currentLoggedInUserId: currentLoggedInUserId,
        // Reset project specific parts if user changes and no project is selected
        ownerUserId: prev.slug ? prev.ownerUserId : null, 
        ownerUsername: prev.slug ? prev.ownerUsername : null,
        slug: prev.slug ? prev.slug : null, // Keep slug if one was active, otherwise null
        vfsId: prev.slug ? prev.vfsId : null,
        currentUserPermission: prev.slug ? prev.currentUserPermission : 'read',
        isLoadedAndSynced: prev.slug ? false : false, // Force re-evaluation for any active project
        currentVfsPathForTerminal: prev.slug ? prev.currentVfsPathForTerminal : '/',
        defaultPtyEnvironment: prev.slug ? prev.defaultPtyEnvironment : 'shell',
      }));
      if (!activeProjectContext.slug) { // If no project was active, clear editor
        setOpenFiles([]); setActiveFile(null);
      }
    }
  }, [currentLoggedInUserId]);
  const detectLanguage = useCallback((fileName) => {
    if (!fileName) return 'plaintext';
    const extension = fileName.split('.').pop().toLowerCase();
    switch (extension) {
      case 'js': case 'jsx': return 'javascript'; case 'ts': case 'tsx': return 'typescript';
      case 'py': return 'python'; case 'java': return 'java'; case 'c': case 'cpp': case 'h': return 'cpp';
      case 'html': return 'html'; case 'css': case 'scss': return 'css';
      case 'json': return 'json'; case 'md': return 'markdown';
      case 'sh': return 'shell'; case 'go': return 'go'; case 'rb': return 'ruby';
      default: return 'plaintext';
    }
  }, []);

  const loadPersistedEditorStateAndFileContents = useCallback(async (projectOwnerId, projectSlug) => {
    if (!projectOwnerId || !projectSlug) return;
    console.log(`EditorPage: Loading persisted state for owner: ${projectOwnerId}, project: ${projectSlug}, Collab: ${isCollabMode}`);
    setIsLoadingProject(true);
    let activeFileToLoad = null; let openFilesFromStorage = [];
    try {
      const persistedOpenJSON = localStorage.getItem(`openFiles_${projectOwnerId}_${projectSlug}`);
      const persistedActivePathJSON = localStorage.getItem(`activeFilePath_${projectOwnerId}_${projectSlug}`);
      openFilesFromStorage = persistedOpenJSON ? JSON.parse(persistedOpenJSON) : [];
      const persistedActivePath = persistedActivePathJSON ? JSON.parse(persistedActivePathJSON) : null;

      const validOpenFiles = openFilesFromStorage.map(f => ({ ...f, content: undefined, isCollaborative: isCollabMode }));
      setOpenFiles(validOpenFiles);

      if (persistedActivePath && validOpenFiles.some(f => f.path === persistedActivePath)) {
        activeFileToLoad = validOpenFiles.find(f => f.path === persistedActivePath);
      } else if (validOpenFiles.length > 0) { activeFileToLoad = validOpenFiles[0]; }

      if (activeFileToLoad) {
        try {
          const res = await axios.get(`/fs/read?userId=${projectOwnerId}&projectSlug=${projectSlug}&path=${encodeURIComponent(activeFileToLoad.path)}`);
          const fileWithContent = { ...activeFileToLoad, content: res.data.content, isCollaborative: isCollabMode };
          setActiveFile(fileWithContent);
          setOpenFiles(prev => prev.map(f => f.path === fileWithContent.path ? fileWithContent : f));
          setEditorLanguage(detectLanguage(fileWithContent.name));
        } catch (err) {
          console.error(`Failed to load content for ${activeFileToLoad.path}:`, err.response?.data?.message || err.message);
          setOpenFiles(prev => prev.filter(f => f.path !== activeFileToLoad.path));
          if (activeFile?.path === activeFileToLoad.path) setActiveFile(null);
        }
      } else { setActiveFile(null); }
    } catch (e) {
      console.error("Error loading persisted editor state from localStorage:", e);
      setOpenFiles([]); setActiveFile(null);
    }
    finally { setIsLoadingProject(false); }
  }, [detectLanguage, isCollabMode]);

  useEffect(() => { // Main Project Activation Effect
    if (activeProjectContext.currentLoggedInUserId && activeProjectContext.ownerUserId && activeProjectContext.slug &&
      !activeProjectContext.isLoadedAndSynced && !isLoadingProject) {
      const activateProject = async () => {
        setIsLoadingProject(true);
        console.log(`EditorPage: Activating project - ${activeProjectContext.slug}, isLoadedAndSynced: ${activeProjectContext.isLoadedAndSynced}, isLoadingProject: ${isLoadingProject}`);
        setIsLoadingProject(true); 
        const projectSessionSyncKey = `sessionSynced_${activeProjectContext.ownerUserId}_${activeProjectContext.slug}`;
        const projectPersistedSyncKey = `initialVFSLoadDone_${activeProjectContext.ownerUserId}_${activeProjectContext.slug}`;
        try {
          if (!sessionSyncedProjectsRef.current.has(projectSessionSyncKey) || localStorage.getItem(projectPersistedSyncKey) !== 'true') {
            console.log(`EditorPage: Initial VFS->Host sync for project "${activeProjectContext.slug}" (Owner: ${activeProjectContext.ownerUserId}).`);
            await axios.post('/fs/sync/vfs-to-host', {
              userId: activeProjectContext.ownerUserId, // Owner of the VFS project to sync
              vfsProjectId: activeProjectContext.vfsId,
              projectSlug: activeProjectContext.slug,
            });
            sessionSyncedProjectsRef.current.add(projectSessionSyncKey);
            localStorage.setItem(projectPersistedSyncKey, 'true');
          } else {
            console.log(`EditorPage: Project "${activeProjectContext.slug}" (Owner: ${activeProjectContext.ownerUserId}) previously synced. Loading from host FS.`);
          }
          await loadPersistedEditorStateAndFileContents(activeProjectContext.ownerUserId, activeProjectContext.slug);
          setActiveProjectContext(prev => ({ ...prev, isLoadedAndSynced: true }));
        } catch (error) {
          console.error("Error activating project:", activeProjectContext.slug, error);
          alert(`Failed to open project "${activeProjectContext.slug}": ${error.response?.data?.message || error.message}`);
          setActiveProjectContext(prev => ({ ...prev, ownerUserId: null, slug: null, vfsId: null, isLoadedAndSynced: false, currentVfsPathForTerminal: '/', defaultPtyEnvironment: 'shell', currentUserPermission: 'read' }));
        } finally { setIsLoadingProject(false); 
          if (isSyncing) { 
            console.log(`EditorPage: Resetting isSyncing flag after project activation for "${activeProjectContext.slug}".`);
            setIsSyncing(false);
          }
        }
      };
      activateProject();
    }
  }, [
    activeProjectContext.currentLoggedInUserId, activeProjectContext.ownerUserId,
    activeProjectContext.slug, activeProjectContext.vfsId,
    activeProjectContext.isLoadedAndSynced, 
    isLoadingProject,
    loadPersistedEditorStateAndFileContents,
    isSyncing
  ]);

  useEffect(() => { // Persist editor state
    if (!activeProjectContext.ownerUserId || !activeProjectContext.slug || !activeProjectContext.isLoadedAndSynced) return;
    const openFilesToPersist = openFiles.map(({ content, isCollaborative, ...rest }) => ({ ...rest }));
    localStorage.setItem(`openFiles_${activeProjectContext.ownerUserId}_${activeProjectContext.slug}`, JSON.stringify(openFilesToPersist));
    localStorage.setItem(`activeFilePath_${activeProjectContext.ownerUserId}_${activeProjectContext.slug}`, JSON.stringify(activeFile?.path || null));
  }, [openFiles, activeFile, activeProjectContext.ownerUserId, activeProjectContext.slug, activeProjectContext.isLoadedAndSynced]);


  const handleCollabToggle = () => {
    const newCollabMode = !isCollabMode;
    setIsCollabMode(newCollabMode);

    if (activeFile) {
      let contentToCarryOver = activeFile.content;
      if (isCollabMode && !newCollabMode && activeYDocRef.current) {
        const yText = activeYDocRef.current.getText('monaco');
        contentToCarryOver = yText.toString();
        console.log("EditorPage: Collab OFF, preserving Yjs content:", contentToCarryOver?.substring(0, 50));
      } else if (!isCollabMode && newCollabMode && activeFile.content !== undefined) {
        console.log("EditorPage: Collab ON, current editor content will be initial for Yjs:", contentToCarryOver?.substring(0, 50));
      }

      const fileMetaForRemount = {
        ...activeFile,
        content: contentToCarryOver,
        isCollaborative: newCollabMode
      };

      setOpenFiles(prevOpen => prevOpen.map(f =>
        f.path === activeFile.path ? fileMetaForRemount : f
      ));
      // Important: Set activeFile to null first to ensure key change causes remount if path is same
      setActiveFile(null);
      setTimeout(() => {
        setActiveFile(fileMetaForRemount);
        setEditorLanguage(detectLanguage(fileMetaForRemount.name));
      }, 0);
    }
  };

  const handleCodeChange = useCallback(async (newCode) => {
    if (isCollabMode || !activeFile || !activeProjectContext.ownerUserId || !activeProjectContext.slug) return;
    if (activeProjectContext.currentUserPermission !== 'write') {
      // console.warn("Read-only: Cannot save changes."); // Optionally notify user
      return;
    }
    const updatedActiveFile = { ...activeFile, content: newCode, isCollaborative: false };
    setActiveFile(updatedActiveFile);
    setOpenFiles(prev => prev.map(f => f.path === activeFile.path ? updatedActiveFile : f));
    try {
      // API calls use ownerUserId for the resource path
      await axios.put(`/fs/write?userId=${activeProjectContext.ownerUserId}&projectSlug=${activeProjectContext.slug}&path=${encodeURIComponent(activeFile.path)}`, { content: newCode });
    } catch (error) { console.error(`Error saving file ${activeFile.name}:`, error); }
  }, [activeFile, activeProjectContext.ownerUserId, activeProjectContext.slug, isCollabMode, activeProjectContext.currentUserPermission]);

  const handleFileSelect = useCallback(async (fileFromTreeOrTab) => {
    if (!fileFromTreeOrTab || !fileFromTreeOrTab.path || !activeProjectContext.ownerUserId || !activeProjectContext.slug) return;

    const projectSlugForPath = activeProjectContext.slug; // Slug of the currently open project
    // Construct terminal path relative to the VFS structure the user is seeing
    // If it's a shared project, fileFromTreeOrTab.path is like /src/file.js
    // So currentVfsPathForTerminal becomes /projectSlug/src or /projectSlug if root of project
    const terminalBaseVfsPath = `/${projectSlugForPath}`;
    const newTerminalPath = fileFromTreeOrTab.type === 'folder'
      ? path.posix.join(terminalBaseVfsPath, fileFromTreeOrTab.path)
      : path.posix.join(terminalBaseVfsPath, path.dirname(fileFromTreeOrTab.path));
    const finalTerminalPath = path.posix.normalize(newTerminalPath === terminalBaseVfsPath ? terminalBaseVfsPath : newTerminalPath);

    setActiveProjectContext(prev => ({ ...prev, currentVfsPathForTerminal: finalTerminalPath }));

    if (fileFromTreeOrTab.type === 'folder') return;

    setIsLoadingProject(true);
    try {
      // API calls use ownerUserId for the resource path
      const res = await axios.get(`/fs/read?userId=${activeProjectContext.ownerUserId}&projectSlug=${projectSlugForPath}&path=${encodeURIComponent(fileFromTreeOrTab.path)}`);
      const fileWithFullContent = {
        ...fileFromTreeOrTab, content: res.data.content, isCollaborative: isCollabMode
      };
      const existingFileIndex = openFiles.findIndex(f => f.path === fileWithFullContent.path && f.projectSlug === projectSlugForPath); // Check projectSlug too
      if (existingFileIndex > -1) {
        setOpenFiles(prev => { const newOpen = [...prev]; newOpen[existingFileIndex] = fileWithFullContent; return newOpen; });
      } else {
        setOpenFiles(prev => [...prev, fileWithFullContent]);
      }
      setActiveFile(fileWithFullContent);
      setEditorLanguage(detectLanguage(fileWithFullContent.name));
    } catch (error) {
      console.error("Error opening/fetching content for file:", fileFromTreeOrTab.path, error);
      alert(`Error loading ${fileFromTreeOrTab.name}: ${error.response?.data?.message || error.message}`);
    }
    finally { setIsLoadingProject(false); }
  }, [openFiles, activeProjectContext.ownerUserId, activeProjectContext.slug, detectLanguage, isCollabMode]);


  const handleTabClose = useCallback((filePathToClose) => {
    const updatedOpenFiles = openFiles.filter((f) => f.path !== filePathToClose);
    setOpenFiles(updatedOpenFiles);
    if (activeFile && activeFile.path === filePathToClose) {
      if (updatedOpenFiles.length > 0) {
        const newActiveFile = updatedOpenFiles[updatedOpenFiles.length - 1];
        // Instead of checking content, just call handleFileSelect which will load if needed
        handleFileSelect(newActiveFile);
      } else { setActiveFile(null); setEditorLanguage('plaintext'); }
    }
  }, [openFiles, activeFile, handleFileSelect]);

  const handleProjectSelected = (projectDataFromSelector) => {
    if (!currentLoggedInUserId) return;
    setOpenFiles([]); setActiveFile(null);

    const ownerId = projectDataFromSelector.ownerId || currentLoggedInUserId;
    const ownerName = projectDataFromSelector.owner?.username; // For display

    setActiveProjectContext({
      currentLoggedInUserId: currentLoggedInUserId,
      ownerUserId: ownerId,
      ownerUsername: ownerName,
      slug: projectDataFromSelector.slug,
      vfsId: projectDataFromSelector.vfsId,
      currentUserPermission: projectDataFromSelector.permissionForCurrentUser || 'write', // Assume write for own projects
      currentVfsPathForTerminal: projectDataFromSelector.isRootWorkspace ? '/' : `/${projectDataFromSelector.slug}`,
      defaultPtyEnvironment: projectDataFromSelector.defaultEnvironment || (projectDataFromSelector.isRootWorkspace ? 'shell' : 'javascript'),
      isLoadedAndSynced: false,
    });
  };

  const handleSwitchProject = () => {
    setOpenFiles([]); setActiveFile(null);
    setActiveProjectContext(prev => ({
      ...prev,
      ownerUserId: null, ownerUsername: null, slug: null, vfsId: null,
      isLoadedAndSynced: false, currentVfsPathForTerminal: '/',
      defaultPtyEnvironment: 'shell', currentUserPermission: 'read'
    }));
  };

  const syncWorkspaceChangesToVFS = async () => {
    if (!activeProjectContext.ownerUserId || !activeProjectContext.slug) return;
    if (activeProjectContext.currentUserPermission !== 'write') {
      alert("You don't have permission to save changes to this project's cloud storage."); return;
    }
    setIsSyncing(true);
    try {
      await axios.post('/fs/sync/host-to-vfs', {
        userId: activeProjectContext.ownerUserId, // Owner's VFS to update
        vfsProjectId: activeProjectContext.vfsId,
        projectSlug: activeProjectContext.slug,
      });
      alert(`Project "${activeProjectContext.slug}" saved to cloud successfully!`);
    } catch (err) { /* ... */ } finally { setIsSyncing(false); }
  };

  const syncVFSChangesToWorkspace = async () => {
    if (!activeProjectContext.ownerUserId || !activeProjectContext.slug) {
      console.warn("syncVFSChangesToWorkspace: No active project selected.");
      return;
    }
    if (activeProjectContext.currentUserPermission !== 'write' && activeProjectContext.ownerUserId !== currentLoggedInUserId) {

      alert("Pulling from cloud requires write permission or ownership if it overwrites changes."); return;
    }
    if (!window.confirm("This will discard any unsaved local changes in your current workspace and pull the latest version from the cloud. Are you sure you want to continue?")) return;
    console.log("syncVFSChangesToWorkspace: Initiating pull from cloud for project:", activeProjectContext.slug);
    setIsSyncing(true);
    const projectSessionSyncKey = `sessionSynced_${activeProjectContext.ownerUserId}_${activeProjectContext.slug}`;
    const projectInitialPersistedSyncKey = `initialVFSLoadDone_${activeProjectContext.ownerUserId}_${activeProjectContext.slug}`;
    sessionSyncedProjectsRef.current.delete(projectSessionSyncKey);
    localStorage.removeItem(projectInitialPersistedSyncKey);
    setOpenFiles([]);
    setActiveFile(null);
    setEditorLanguage('plaintext');
    setActiveProjectContext(prev => ({ ...prev, isLoadedAndSynced: false }));
  };

  const handleSaveProjectAsTemplate = async (templateData) => {
    if (!activeProjectContext.ownerUserId || !activeProjectContext.slug) return;
    if (activeProjectContext.currentUserPermission !== 'write' && activeProjectContext.ownerUserId !== currentLoggedInUserId) {
      alert("You need write permission or be the owner to save this project as a template."); return;
    }
    setIsSyncing(true);
    try {
      await axios.post('/vfs/user-templates', {
        sourceProjectSlug: activeProjectContext.slug, // Backend uses authenticated user to scope this slug
        templateName: templateData.name,
        templateDetails: templateData.details,
      });
      alert(`Project saved as template "${templateData.name}"!`);
      setShowSaveAsTemplateModal(false);
    } catch (err) { console.error("Error saving as template:", err); alert(`Failed to save as template: ${err.response?.data?.message || err.message}`); } finally { setIsSyncing(false); }
  };

  const handleOpenShareModal = () => {
    if (!activeProjectContext.vfsId || !activeProjectContext.slug ||
      activeProjectContext.ownerUserId !== currentLoggedInUserId) {
      alert("You can only share projects you own.");
      return;
    }
    setProjectToShare({
      id: activeProjectContext.vfsId, // This is the VFS ID of the project root folder
      name: activeProjectContext.slug
    });
    setShowShareModal(true);
  };

  const handleShareProjectApiCall = async (projectToShareData, shareWithUserIdentifier, permissionLevel) => {
    if (!projectToShareData || !projectToShareData.id) {
      throw new Error("Project to share is not properly defined.");
    }
    setIsSyncing(true); // Use isSyncing or a new state like isSharing
    try {
      // API endpoint expects projectId in URL, user identifier and permission in body
      const response = await axios.post(`/vfs/projects/${projectToShareData.id}/share`, {
        shareWithUserIdentifier: shareWithUserIdentifier,
        permission: permissionLevel,
      });
      console.log("Project shared successfully:", response.data);
      // No need to close modal here, ShareProjectModal handles its own success message and close
      // Optionally, refresh list of shared users for this project if displaying them
      return response.data; // To allow ShareProjectModal to show success
    } catch (error) {
      console.error("Error sharing project:", error);
      throw error; // Re-throw for ShareProjectModal to catch and display
    } finally {
      setIsSyncing(false);
    }
  };

  // --- Render Logic ---
  if (isAuthSessionLoading) return <GlobalSpinner message="Initializing session..." />;
  if (!currentLoggedInUserId) return <Navigate to="/login" replace />;

  if (!activeProjectContext.slug || (!activeProjectContext.isLoadedAndSynced && !isLoadingProject)) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-gray-800 text-white">
        {/* Show loading spinner only if isLoadingProject is true AND a slug is already set (meaning it's trying to load that slug) */}
        {(isLoadingProject && activeProjectContext.slug) ?
          <GlobalSpinner message={`Opening project: ${activeProjectContext.slug}...`} /> :
          <ProjectSelector userId={currentLoggedInUserId} onSelectProject={handleProjectSelected} onSetLoading={setIsLoadingProject} />
        }
      </div>
    );
  }
  if (isLoadingProject && !activeProjectContext.isLoadedAndSynced && activeProjectContext.slug) {
    return <GlobalSpinner message={`Loading workspace for: ${activeProjectContext.slug}...`} />;
  }

  const canWriteActiveProject = activeProjectContext.currentUserPermission === 'write' || activeProjectContext.ownerUserId === currentLoggedInUserId;

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="h-screen w-screen flex flex-col bg-gray-900 text-white font-sans">
        <header className="p-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between text-xs shadow-md shrink-0 h-[42px]">
          <div className="flex items-center">
            <FaCode className="text-indigo-400 text-lg mr-2 ml-1" />
            <span className="text-gray-400">Project:</span>
            <strong className="text-indigo-400 ml-1.5 truncate max-w-[150px]" title={activeProjectContext.slug}>{activeProjectContext.slug}</strong>
            {activeProjectContext.ownerUserId !== currentLoggedInUserId && activeProjectContext.ownerUsername && (
              <span className="ml-2 text-xs text-yellow-400">(Owned by: {activeProjectContext.ownerUsername},
                Access: {activeProjectContext.currentUserPermission})</span>
            )}
            <label htmlFor="collabToggle" className="ml-4 flex items-center cursor-pointer select-none">
              <div className="relative">
                <input type="checkbox" id="collabToggle" className="sr-only" checked={isCollabMode} onChange={handleCollabToggle} />
                <div className={`block bg-gray-600 w-10 h-6 rounded-full transition-colors ${isCollabMode ? 'bg-green-500' : ''}`}></div>
                <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${isCollabMode ? 'translate-x-full' : ''}`}></div>
              </div>
              <span className={`ml-2 text-sm font-medium ${isCollabMode ? 'text-green-400' : 'text-gray-400'}`}>
                {isCollabMode ? <FaUsers className="inline mr-1" /> : <FaUserSlash className="inline mr-1" />}
                {isCollabMode ? 'Collab On' : 'Collab Off'}
              </span>
            </label>
          </div>
          <div className="flex items-center space-x-2"> {/* Action Buttons */}
            {activeProjectContext.ownerUserId === currentLoggedInUserId && ( // Share button only for owner
              <button onClick={handleOpenShareModal} /* ... */ > <FaShareAlt className="mr-1.5" /> Share </button>
            )}
            <button onClick={() => setShowSaveAsTemplateModal(true)} disabled={!canWriteActiveProject || isSyncing || isLoadingProject || !activeProjectContext.isLoadedAndSynced} /* ... */ > <FaPlusSquare className="mr-1.5" /> Save as Template </button>
            <button onClick={syncVFSChangesToWorkspace} disabled={!canWriteActiveProject || isSyncing || isLoadingProject} /* ... */ > <FaCloudDownloadAlt className="mr-1.5" /> Pull from Cloud </button>
            <button onClick={syncWorkspaceChangesToVFS} disabled={!canWriteActiveProject || isSyncing || isLoadingProject} /* ... */ > <FaCloudUploadAlt className="mr-1.5" /> Save to Cloud </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden"> {/* Main content area */}
          <aside className="w-60 md:w-64 lg:w-72 bg-[#252526] border-r border-gray-700 flex flex-col h-full shadow-lg"> {/* Sidebar */}
            <div className="px-3 py-2.5 border-b border-gray-600 flex justify-between items-center min-h-[40px] shrink-0">
              <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-wider truncate" title={activeProjectContext.slug}>
                {activeProjectContext.slug || 'EXPLORER'}
              </h2>
              <button onClick={handleSwitchProject} className="text-xs text-indigo-400 hover:text-indigo-300 px-1.5 py-1 hover:bg-gray-700 rounded flex items-center transition-colors" title="Switch Project" > <FaExchangeAlt className="mr-1.5" /> Switch </button>
            </div>
            <div className="flex-grow overflow-y-auto custom-scrollbar p-1">
              {activeProjectContext.isLoadedAndSynced ? (
                <FileTree
                  userId={activeProjectContext.ownerUserId} 
                  projectSlug={activeProjectContext.slug}
                  onFileSelect={handleFileSelect}
                  canWrite={canWriteActiveProject} // Pass write permission
                  onShareProject={activeProjectContext.ownerUserId === currentLoggedInUserId ? handleOpenShareModal : undefined}
                />
              ) : (<div className="p-4 text-sm text-gray-500 text-center flex flex-col items-center justify-center h-full"><FaSpinner className="animate-spin text-xl mb-2" />Loading files...</div>)}
            </div>
          </aside>

          <main className="flex-1 flex flex-col overflow-hidden h-full"> {/* Editor & Terminal Area */}
            {openFiles.length > 0 && (
              <div className="flex items-center h-10 bg-gray-700 border-b border-gray-600 overflow-x-auto whitespace-nowrap text-sm hide-scrollbar shrink-0 shadow-sm">
                {openFiles.map((file) => (
                  <div key={file.path || file.name} className={`flex items-center px-4 py-2 border-r border-gray-600 cursor-pointer h-full transition-colors ${activeFile?.path === file.path ? 'bg-gray-800 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-650'}`}
                    onClick={() => { handleFileSelect(file); /* handleFileSelect now handles content loading if needed */ }} >
                    <span className="truncate max-w-[150px] group-hover:text-white">{file.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); handleTabClose(file.path); }} className="ml-3 text-gray-500 hover:text-red-400 text-xs leading-none p-0.5 rounded-full hover:bg-gray-500 transition-colors" title={`Close ${file.name}`}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <Split direction="vertical" sizes={activeFile || openFiles.length > 0 ? [70, 30] : [0, 100]} className="flex-1 flex flex-col h-full" gutterSize={8} minSize={60}
              gutterElement={(dimension, elementIndex, gutter) => { const el = document.createElement('div'); el.className = `gutter gutter-${dimension} bg-gray-700 hover:bg-gray-600 cursor-row-resize transition-colors`; return el; }} >
              <div className="overflow-hidden flex-1 flex flex-col bg-[#1e1e1e]"> {/* Editor Pane Wrapper */}
                {activeFile ? (
                  isCollabMode ? (
                    <CollaborativeEditor
                      key={`${activeProjectContext.slug}-${activeFile.path}-${isCollabMode}`}
                      projectContext={{ userId: activeProjectContext.ownerUserId, slug: activeProjectContext.slug }} // Yjs room based on owner
                      fileContext={{ path: activeFile.path, name: activeFile.name, initialContent: activeFile.content || '' }}
                      language={editorLanguage}
                      onSetYDoc={setActiveYDoc}
                    />
                  ) : (<Editor code={activeFile.content || ''} setCode={handleCodeChange} language={editorLanguage} setLanguage={setEditorLanguage} readOnly={!canWriteActiveProject} />)
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 text-lg p-4 text-center">
                    <FaFileCode className="text-6xl text-gray-700 mb-4" />
                    {(isLoadingProject && !activeFile) ? <><FaSpinner className="animate-spin mr-2" />Loading...</> : "Select or create a file to begin."}
                  </div>
                )}
              </div>
              <div className="bg-[#141414] text-white text-sm overflow-hidden flex-1 flex flex-col border-t-2 border-gray-700"> {/* Terminal Pane */}
                {activeProjectContext.isLoadedAndSynced ? (
                  <TerminalComponent
                    projectVfsPathForNewTerminals={activeProjectContext.currentVfsPathForTerminal}
                    defaultPtyEnvironmentForNewTerminals={activeProjectContext.defaultPtyEnvironment}
                    // PTY backend needs to know the owner of the files it will be working on
                    ptyProjectOwnerId={activeProjectContext.ownerUserId}
                    ptyProjectSlug={activeProjectContext.slug}
                  />
                ) : (<div className="p-4 text-gray-500 flex items-center justify-center h-full">Terminal loading...</div>)}
              </div>
            </Split>
          </main>
        </div>

        {showSaveAsTemplateModal && <SaveAsTemplateModal
          isActive={showSaveAsTemplateModal}
          onClose={() => setShowSaveAsTemplateModal(false)}
          onSave={handleSaveProjectAsTemplate}
          currentProjectName={activeProjectContext.slug}
          currentProjectEnv={activeProjectContext.defaultPtyEnvironment}
        />}
        <ShareProjectModal isActive={showShareModal} onClose={() => { setShowShareModal(false); setProjectToShare(null); }} onShare={handleShareProjectApiCall} projectToShare={projectToShare} isLoading={isSyncing} />
      </div>
    </DndProvider>
  );
};
export default EditorPage;