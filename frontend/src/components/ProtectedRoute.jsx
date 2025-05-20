// In EditorPage.jsx

const syncVFSChangesToWorkspace = async () => {
  if (!activeProjectContext.ownerUserId || !activeProjectContext.slug) {
      console.warn("syncVFSChangesToWorkspace: No active project selected.");
      return;
  }
  if (activeProjectContext.currentUserPermission !== 'write' && activeProjectContext.ownerUserId !== currentLoggedInUserId) {
      alert("Pulling from cloud requires write permission or ownership to potentially overwrite local changes.");
      return;
  }
  // More explicit confirmation message
  if (!window.confirm("This will discard any unsaved local changes in your current workspace and pull the latest version from the cloud. Are you sure you want to continue?")) {
      return;
  }

  console.log("syncVFSChangesToWorkspace: Initiating pull from cloud for project:", activeProjectContext.slug);
  setIsSyncing(true); // Indicate a sync operation is in progress.
                      // setIsLoadingProject will be handled by the main activation useEffect.

  const projectSessionSyncKey = `sessionSynced_${activeProjectContext.ownerUserId}_${activeProjectContext.slug}`;
  const projectInitialPersistedSyncKey = `initialVFSLoadDone_${activeProjectContext.ownerUserId}_${activeProjectContext.slug}`;

  // Clear local cache flags to force re-sync from VFS in the main useEffect
  sessionSyncedProjectsRef.current.delete(projectSessionSyncKey);
  localStorage.removeItem(projectInitialPersistedSyncKey);

  // Clear current editor state as it will be reloaded from the (potentially) new VFS state.
  // This prevents showing stale tabs or content before the reload.
  setOpenFiles([]);
  setActiveFile(null);
  setEditorLanguage('plaintext'); // Reset language as no file is active

  // Set isLoadedAndSynced to false. This, along with other activeProjectContext fields,
  // will trigger the main project activation useEffect. That useEffect is responsible for:
  // - Setting setIsLoadingProject(true)
  // - Calling the /fs/sync/vfs-to-host API endpoint
  // - Loading file contents
  // - Setting setIsLoadingProject(false) and isLoadedAndSynced(true)
  // - Setting setIsSyncing(false) in its finally block (see change below)
  setActiveProjectContext(prev => ({ ...prev, isLoadedAndSynced: false }));

  // Note: setIsLoadingProject(true) is NOT set here.
  // isSyncing will be set to false by the main project activation useEffect's finally block.
};

// ... inside your main project activation useEffect ...
useEffect(() => { // Main Project Activation Effect
  if (activeProjectContext.currentLoggedInUserId && activeProjectContext.ownerUserId && activeProjectContext.slug &&
    !activeProjectContext.isLoadedAndSynced && !isLoadingProject) {
    const activateProject = async () => {
      console.log(`EditorPage: Activating project - ${activeProjectContext.slug}, isLoadedAndSynced: ${activeProjectContext.isLoadedAndSynced}, isLoadingProject: ${isLoadingProject}`);
      setIsLoadingProject(true); // THIS useEffect handles isLoadingProject

      const projectSessionSyncKey = `sessionSynced_${activeProjectContext.ownerUserId}_${activeProjectContext.slug}`;
      const projectPersistedSyncKey = `initialVFSLoadDone_${activeProjectContext.ownerUserId}_${activeProjectContext.slug}`;
      try {
        if (!sessionSyncedProjectsRef.current.has(projectSessionSyncKey) || localStorage.getItem(projectPersistedSyncKey) !== 'true') {
          console.log(`EditorPage: Performing VFS->Host sync for project "${activeProjectContext.slug}" (Owner: ${activeProjectContext.ownerUserId}).`);
          await axios.post('/fs/sync/vfs-to-host', {
            userId: activeProjectContext.ownerUserId,
            vfsProjectId: activeProjectContext.vfsId,
            projectSlug: activeProjectContext.slug,
          });
          sessionSyncedProjectsRef.current.add(projectSessionSyncKey);
          localStorage.setItem(projectPersistedSyncKey, 'true');
          console.log(`EditorPage: VFS->Host sync completed for "${activeProjectContext.slug}".`);
        } else {
          console.log(`EditorPage: Project "${activeProjectContext.slug}" (Owner: ${activeProjectContext.ownerUserId}) VFS->Host sync previously done or skipped. Loading from host FS.`);
        }
        // loadPersistedEditorStateAndFileContents will set/unset its own isLoadingProject if needed,
        // but the outer one here ensures the global "Loading workspace..." spinner is shown.
        await loadPersistedEditorStateAndFileContents(activeProjectContext.ownerUserId, activeProjectContext.slug);
        setActiveProjectContext(prev => ({ ...prev, isLoadedAndSynced: true }));
        console.log(`EditorPage: Project "${activeProjectContext.slug}" fully activated and loaded.`);
      } catch (error) {
        console.error("Error activating project:", activeProjectContext.slug, error);
        alert(`Failed to open project "${activeProjectContext.slug}": ${error.response?.data?.message || error.message}`);
        setActiveProjectContext(prev => ({ ...prev, ownerUserId: null, slug: null, vfsId: null, isLoadedAndSynced: false, currentVfsPathForTerminal: '/', defaultPtyEnvironment: 'shell', currentUserPermission: 'read' }));
      } finally {
        setIsLoadingProject(false);
        if (isSyncing) { // If a sync operation (like pull or push) triggered this activation cycle
          console.log(`EditorPage: Resetting isSyncing flag after project activation for "${activeProjectContext.slug}".`);
          setIsSyncing(false); // Reset sync flag as the operation is complete
        }
      }
    };
    activateProject();
  }
}, [
  activeProjectContext.currentLoggedInUserId, activeProjectContext.ownerUserId,
  activeProjectContext.slug, activeProjectContext.vfsId,
  activeProjectContext.isLoadedAndSynced, // Key trigger
  isLoadingProject, // Condition to prevent re-entry while already loading
  loadPersistedEditorStateAndFileContents,
  isSyncing // Added isSyncing to dependencies to ensure finally block correctly assesses it
]);