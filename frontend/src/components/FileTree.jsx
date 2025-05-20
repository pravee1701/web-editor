import React, { useEffect, useState, useCallback } from 'react';
import axios from '../utils/axios';
import FileItem from './FileItem';
import path from 'path-browserify';
import { FaSearch, FaPlus, FaFolder, FaFile, FaSync, FaSpinner } from 'react-icons/fa';

// Placeholder for GlobalSpinner if not imported from elsewhere
const GlobalSpinner = () => (
    <div className="flex items-center justify-center h-full">
        <FaSpinner className="animate-spin text-blue-500 text-xl" />
    </div>
);


const FileTree = ({ userId, projectSlug, onFileSelect, onShareProject }) => {
  // treeState: Map<string (folderPathKey), { childrenData: FileObjectFromServer[], isLoading: boolean, isExpanded: boolean }>
  // FileObjectFromServer: { name, type, path (full vfs-like path from project root) }
  const [treeState, setTreeState] = useState(new Map([['/', { childrenData: [], isLoading: false, isExpanded: true }]]));
  const [error, setError] = useState(null);

  const [showCreateInputForPath, setShowCreateInputForPath] = useState(null); // Path of parent for new item
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState('file'); // 'file' or 'folder'
  const [searchTerm, setSearchTerm] = useState(''); // For client-side filtering (optional)

  const fetchNodeData = useCallback(async (folderPathKeyToFetch) => {
    if (!userId || !projectSlug) {
      setTreeState(new Map([['/', { childrenData: [], isLoading: false, isExpanded: true }]]));
      return;
    }

    setTreeState(prev => {
      const newState = new Map(prev);
      const existingNode = newState.get(folderPathKeyToFetch) || { childrenData: [], isExpanded: false };
      newState.set(folderPathKeyToFetch, { ...existingNode, isLoading: true });
      return newState;
    });
    setError(null);

    try {
      const apiPath = folderPathKeyToFetch === '/' ? '' : folderPathKeyToFetch.startsWith('/') ? folderPathKeyToFetch.substring(1) : folderPathKeyToFetch;
      const response = await axios.get(`/fs/list?userId=${userId}&projectSlug=${projectSlug}&path=${encodeURIComponent(apiPath)}`);
      const fetchedChildren = response.data || [];

      setTreeState(prev => {
        const newState = new Map(prev);
        const parentNode = newState.get(folderPathKeyToFetch) || { childrenData: [], isExpanded: false };
        
        // Augment children with their own initial state if they are folders and not yet in treeState
        const processedChildren = fetchedChildren.map(child => {
            if (child.type === 'folder' && !newState.has(child.path)) {
                newState.set(child.path, { childrenData: [], isLoading: false, isExpanded: false });
            }
            return child; // API returns { name, type, path }
        });

        newState.set(folderPathKeyToFetch, { ...parentNode, childrenData: processedChildren, isLoading: false });
        return newState;
      });
    } catch (err) {
      console.error(`Error fetching files for path "${folderPathKeyToFetch}":`, err);
      const errorMessage = err.response?.data?.message || `Failed to load files for ${folderPathKeyToFetch}.`;
      setError(errorMessage);
      setTreeState(prev => {
        const newState = new Map(prev);
        const node = newState.get(folderPathKeyToFetch) || { childrenData: [], isExpanded: false };
        newState.set(folderPathKeyToFetch, { ...node, childrenData: [], isLoading: false }); // Clear childrenData on error
        return newState;
      });
    }
  }, [userId, projectSlug]);

  useEffect(() => {
    if (userId && projectSlug) {
      fetchNodeData('/');
    } else {
      setTreeState(new Map([['/', { childrenData: [], isLoading: false, isExpanded: true }]]));
    }
  }, [userId, projectSlug, fetchNodeData]);

  const handleExpandFolder = useCallback((folderPath, shouldExpand) => {
    setTreeState(prev => {
      const newState = new Map(prev);
      const node = newState.get(folderPath);
      if (node) {
        newState.set(folderPath, { ...node, isExpanded: shouldExpand });
        if (shouldExpand && node.childrenData.length === 0 && !node.isLoading) {
          fetchNodeData(folderPath);
        }
      }
      return newState;
    });
  }, [fetchNodeData]);
  
  const handleRefreshPath = useCallback((pathToRefresh) => {
    const pathKey = pathToRefresh === '/' || !pathToRefresh ? '/' : pathToRefresh;
    fetchNodeData(pathKey);
    // Optionally re-expand the refreshed folder
    setTreeState(prev => {
        const newState = new Map(prev);
        const node = newState.get(pathKey);
        if (node && node.childrenData) { // Check if it's a folder (has childrenData array)
             newState.set(pathKey, { ...node, isExpanded: true });
        }
        return newState;
    });
  }, [fetchNodeData]);

  const handleCreateItemSubmit = async () => {
    const name = newItemName.trim();
    if (!name || !userId || !projectSlug) return;

    const parentPathKey = showCreateInputForPath === null ? '/' : showCreateInputForPath;
    const newItemFullPath = path.posix.join(parentPathKey, name);

    try {
      if (newItemType === 'folder') {
        await axios.post(`/fs/mkdir?userId=${userId}&projectSlug=${projectSlug}`, { path: newItemFullPath });
      } else { // file
        await axios.put(`/fs/write?userId=${userId}&projectSlug=${projectSlug}&path=${encodeURIComponent(newItemFullPath)}`, { content: '' });
      }
      handleRefreshPath(parentPathKey);
      setShowCreateInputForPath(null);
      setNewItemName('');
    } catch (err) {
      console.error(`Create ${newItemType} error:`, err);
      alert(`Failed to create ${newItemType}: ${err.response?.data?.message || err.message}`);
    }
  };

  const openCreateInput = (parentPath = '/') => {
    setShowCreateInputForPath(parentPath);
    setNewItemType('file');
    setNewItemName('');
  };

  const renderFileNodesRecursive = (currentFolderPathKey, currentNestingLevel) => {
    const parentNodeState = treeState.get(currentFolderPathKey);

    if (!parentNodeState || (!parentNodeState.isLoading && parentNodeState.childrenData.length === 0 && currentFolderPathKey !== '/')) {
      // This case is handled by FileItem itself showing "(empty)" if its children array is empty
      // Or by the loading indicator if isLoadingChildren is true
    }
    if (!parentNodeState || !parentNodeState.childrenData) { // No data for this folder yet
        if (parentNodeState?.isLoading) return null; // Loading indicator will be shown by FileItem
        return null;
    }

    return parentNodeState.childrenData
      .sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
      })
      .map((item) => { // item is { name, type, path } from API
        const itemState = treeState.get(item.path) || { childrenData: [], isLoading: false, isExpanded: false };
        return (
          <FileItem
            key={item.path}
            file={item} // Basic file data
            projectContext={{ userId, projectSlug }}
            onSelectFile={onFileSelect}
            onExpandFolder={handleExpandFolder}
            onRefreshPath={handleRefreshPath}
            nestingLevel={currentNestingLevel}
            isExpanded={itemState.isExpanded}
            isLoadingChildren={itemState.isLoading} 
            childrenToRender={
              item.type === 'folder' && itemState.isExpanded && !itemState.isLoading && itemState.childrenData
                ? renderFileNodesRecursive(item.path, currentNestingLevel + 1)
                : null
            }
            onShareProject={onShareProject}
          />
        );
      });
  };

  const rootNodeState = treeState.get('/');

  if (!userId || !projectSlug) {
    return <div className="p-4 text-sm text-gray-400">Select a project to view files.</div>;
  }
  if (!rootNodeState) { // Should be initialized
    return <GlobalSpinner />;
  }

  return (
    <div className="flex flex-col h-full bg-[#252526] text-gray-300 text-sm select-none">
      <div className="flex items-center p-2 border-b border-gray-700 space-x-1">
        <button onClick={() => openCreateInput('/')} className="p-1.5 rounded hover:bg-gray-700" title="New File at Root"><FaFile size={12}/></button>
        <button onClick={() => { setNewItemType('folder'); openCreateInput('/'); }} className="p-1.5 rounded hover:bg-gray-700" title="New Folder at Root"><FaFolder size={12}/></button>
        <button onClick={() => handleRefreshPath('/')} className="p-1.5 rounded hover:bg-gray-700" title="Refresh Project"><FaSync size={12} className={rootNodeState.isLoading ? "animate-spin" : ""} /></button>
      </div>

      {showCreateInputForPath !== null && (
          <div className="p-2 border-b border-gray-700 bg-gray-700">
            <div className="text-xs mb-1 text-gray-400">New {newItemType} in {showCreateInputForPath === '/' ? 'project root' : showCreateInputForPath.split('/').pop()}:</div>
            <input type="text" placeholder="Enter name..." value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateItemSubmit();
                  else if (e.key === 'Escape') setShowCreateInputForPath(null);
              }}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs w-full outline-none focus:ring-1 focus:ring-blue-500 text-white" autoFocus />
            <div className="flex justify-between items-center mt-1.5">
              <div className="flex space-x-1">
                <button onClick={() => setNewItemType('file')} className={`px-1.5 py-0.5 rounded text-xs ${newItemType==='file' ? 'bg-blue-600 text-white' : 'bg-gray-600 hover:bg-gray-500 text-gray-300'}`}>File</button>
                <button onClick={() => setNewItemType('folder')} className={`px-1.5 py-0.5 rounded text-xs ${newItemType==='folder' ? 'bg-blue-600 text-white' : 'bg-gray-600 hover:bg-gray-500 text-gray-300'}`}>Folder</button>
              </div>
              <button onClick={handleCreateItemSubmit} className="bg-green-600 hover:bg-green-700 px-2 py-0.5 rounded text-xs text-white">Create</button>
            </div>
          </div>
      )}

      <div className="flex-1 overflow-y-auto p-1">
        {rootNodeState.isLoading && rootNodeState.childrenData.length === 0 ? (
          <div className="p-4 text-center"><FaSpinner className="animate-spin inline mr-2" />Loading project...</div>
        ) : error && rootNodeState.childrenData.length === 0 ? (
            <div className="p-4 text-center text-red-400">Error: {error}</div>
        ) : rootNodeState.childrenData.length === 0 && !rootNodeState.isLoading ? (
            <div className="p-4 text-center text-gray-500">Project is empty.</div>
        ): (
          renderFileNodesRecursive('/', 0)
        )}
      </div>
    </div>
  );
};
export default FileTree;