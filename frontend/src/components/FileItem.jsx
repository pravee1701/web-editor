import React, { useState, useRef, useEffect } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import path from 'path-browserify';
import {
  FaFolder, FaFolderOpen, FaFile, FaJs, FaHtml5, FaCss3,
  FaReact, FaMarkdown, FaPython, FaJava, FaCuttlefish, // FaCuttlefish is a decent generic code/C++ icon
  FaEllipsisH, FaSpinner,
  FaShareAlt
} from 'react-icons/fa';
import axios from '../utils/axios'; // Your configured axios instance

const FileItem = ({
  file,              // API data: { name: string, type: 'file'|'folder', path: string (full vfs-like path from project root) }
  projectContext,    // { userId, projectSlug }
  onSelectFile,
  onExpandFolder,    // (folderPath: string, expand: boolean) => void
  onRefreshPath,     // (pathToRefresh: string) => void
  nestingLevel = 0,
  isExpanded,        
  isLoadingChildren, 
  childrenToRender,
  onShareProject,
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(file.name);
  const [showRightClickMenu, setShowRightClickMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [showThreeDotMenu, setShowThreeDotMenu] = useState(false);

  const fileNameInputRef = useRef(null);
  const itemDivRef = useRef(null);
  const menuRef = useRef(null); // Single ref for any open menu
  const threeDotButtonRef = useRef(null);

  useEffect(() => {
    setNewName(file.name); // Sync newName if file.name prop changes (e.g., after rename)
  }, [file.name]);

  const getFileIcon = () => {
    if (file.type === 'folder') {
      return isExpanded ? <FaFolderOpen className="text-yellow-400 mr-2" /> : <FaFolder className="text-yellow-400 mr-2" />;
    }
    const extension = file.name.split('.').pop().toLowerCase();
    switch (extension) {
      case 'js': case 'jsx': return <FaJs className="text-yellow-300 mr-2" />;
      case 'ts': case 'tsx': return <FaReact className="text-blue-400 mr-2" />;
      case 'html': return <FaHtml5 className="text-orange-500 mr-2" />;
      case 'css': case 'scss': return <FaCss3 className="text-blue-500 mr-2" />;
      case 'py': return <FaPython className="text-green-500 mr-2" />;
      case 'java': return <FaJava className="text-red-500 mr-2" />;
      case 'c': case 'cpp': case 'h': return <FaCuttlefish className="text-indigo-500 mr-2" />;
      case 'md': return <FaMarkdown className="text-gray-400 mr-2" />;
      default: return <FaFile className="text-gray-400 mr-2" />;
    }
  };

  const handleClick = (e) => {
    e.stopPropagation(); // Prevent event bubbling, especially if nested
    if (isRenaming) return;
    if (file.type === 'folder') {
      onExpandFolder(file.path, !isExpanded);
    } else {
      onSelectFile(file); // file here contains {name, type, path}
    }
  };

  const handleRenameSubmit = async () => {
    const trimmedNewName = newName.trim();
    if (trimmedNewName && trimmedNewName !== file.name && projectContext.userId && projectContext.projectSlug) {
      try {
        await axios.post(`/fs/rename?userId=${projectContext.userId}&projectSlug=${projectContext.projectSlug}`, {
          oldPath: file.path,
          newName: trimmedNewName,
        });
        onRefreshPath(path.dirname(file.path)); // Refresh parent directory
      } catch (err) {
        console.error("Rename failed for:", file.path, "to", trimmedNewName, err);
        alert(`Rename failed: ${err.response?.data?.message || err.message}`);
        setNewName(file.name); // Revert name on failure
      }
    }
    setIsRenaming(false);
  };

  const handleDelete = async () => {
    if (window.confirm(`Are you sure you want to delete "${file.name}"? This cannot be undone.`)) {
      if (projectContext.userId && projectContext.projectSlug) {
        try {
          await axios.delete(`/fs/delete?userId=${projectContext.userId}&projectSlug=${projectContext.projectSlug}&path=${encodeURIComponent(file.path)}`);
          onRefreshPath(path.dirname(file.path));
        } catch (err) {
          console.error("Delete failed for:", file.path, err);
          alert(`Delete failed: ${err.response?.data?.message || err.message}`);
        }
      }
    }
  };

  const handleCreateInFolder = async (type) => {
    if (file.type !== 'folder') return; // Should only be called on folders
    const itemName = prompt(`Enter new ${type} name for folder "${file.name}":`);
    if (itemName && itemName.trim() && projectContext.userId && projectContext.projectSlug) {
        const newItemPath = path.posix.join(file.path, itemName.trim());
        try {
            if (type === 'folder') {
                await axios.post(`/fs/mkdir?userId=${projectContext.userId}&projectSlug=${projectContext.projectSlug}`, { path: newItemPath });
            } else { // file
                await axios.put(`/fs/write?userId=${projectContext.userId}&projectSlug=${projectContext.projectSlug}&path=${encodeURIComponent(newItemPath)}`, { content: '' });
            }
            onRefreshPath(file.path); // Refresh this folder's content
            if (!isExpanded) { // If folder wasn't expanded, expand it to show new item
                onExpandFolder(file.path, true);
            }
        } catch (err) {
            console.error(`Create ${type} in ${file.path} failed:`, err);
            alert(`Create ${type} failed: ${err.response?.data?.message || err.message}`);
        }
    }
  };

  const handleRightClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowRightClickMenu(true);
    setShowThreeDotMenu(false);
  };

  const toggleThreeDotMenu = (e) => {
    e.stopPropagation();
    if (threeDotButtonRef.current) {
        const rect = threeDotButtonRef.current.getBoundingClientRect();
        // Position menu more reliably below and slightly to the left of the button
        setContextMenuPosition({ x: rect.left - 192 + rect.width, y: rect.bottom + 2 }); // 192 is w-48 in tailwind
    }
    setShowThreeDotMenu(prev => !prev);
    setShowRightClickMenu(false);
  };

  const handleMenuAction = (action) => {
    setShowRightClickMenu(false);
    setShowThreeDotMenu(false);
    switch (action) {
      case 'rename': setIsRenaming(true); break;
      case 'delete': handleDelete(); break;
      case 'createFile': handleCreateInFolder('file'); break;
      case 'createFolder': handleCreateInFolder('folder'); break;
      case 'shareProject':
        if (file.type === 'folder' && nestingLevel === 0 && onShareProject) { 
            onShareProject(file);
        }
        break;
      default: break;
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        if (showThreeDotMenu && threeDotButtonRef.current && threeDotButtonRef.current.contains(event.target)) {
          return; 
        }
        setShowRightClickMenu(false);
        setShowThreeDotMenu(false);
      }
    };
    if (showRightClickMenu || showThreeDotMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => { document.removeEventListener('mousedown', handleClickOutside); };
    }
  }, [showRightClickMenu, showThreeDotMenu]);

  useEffect(() => {
    if (isRenaming && fileNameInputRef.current) {
      fileNameInputRef.current.focus();
      fileNameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleRenameSubmit(); }
    if (e.key === 'Escape') { setIsRenaming(false); setNewName(file.name); }
  };
  
  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'FILE_ITEM',
    item: { id: file.path, name: file.name, type: file.type, originalPath: file.path, parentPath: path.dirname(file.path) },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  }));

  const [{ isOver, canDrop }, drop] = useDrop(() => ({
    accept: 'FILE_ITEM',
    canDrop: (draggedItem) => file.type === 'folder' && draggedItem.originalPath !== file.path && !file.path.startsWith(draggedItem.originalPath + '/'),
    drop: async (draggedItem) => {
        if (projectContext.userId && projectContext.projectSlug) {
            const newNameInTarget = draggedItem.name; // Keep original name when moving
            const targetParentPath = file.path; // This is the folder we are dropping into
            const newPathInTargetFolder = path.posix.join(targetParentPath, newNameInTarget);
            try {
                await axios.post(`/fs/move?userId=${projectContext.userId}&projectSlug=${projectContext.projectSlug}`, {
                    oldPath: draggedItem.originalPath,
                    newPath: newPathInTargetFolder,
                });
                onRefreshPath(draggedItem.parentPath === '.' ? '/' : draggedItem.parentPath); // Refresh source parent
                onRefreshPath(targetParentPath); // Refresh target folder
            } catch (err) {
                console.error("Move failed:", err);
                alert(`Move failed: ${err.response?.data?.message || err.message}`);
            }
        }
    },
    collect: (monitor) => ({ isOver: monitor.isOver(), canDrop: monitor.canDrop() }),
  }), [file.path, projectContext, onRefreshPath]); // Added file.path to dependencies of useDrop

  const itemDragRef = file.type === 'folder' ? (node) => drag(drop(node)) : drag;

  const renderContextMenuItems = () => (
    <>
      {file.type === 'folder' && (
        <>
          <div className="px-3 py-1.5 hover:bg-gray-600 cursor-pointer flex items-center" onClick={() => handleMenuAction('createFile')}><FaFile className="mr-2 text-xs"/>New File</div>
          <div className="px-3 py-1.5 hover:bg-gray-600 cursor-pointer flex items-center" onClick={() => handleMenuAction('createFolder')}><FaFolder className="mr-2 text-xs"/>New Folder</div>
          {nestingLevel === 0 && onShareProject && ( // Only show for root folders if onShareProject is provided
            <div className="px-3 py-1.5 hover:bg-gray-600 cursor-pointer flex items-center" onClick={() => handleMenuAction('shareProject')}>
              <FaShareAlt className="mr-2 text-xs text-blue-400"/>Share Project
            </div>
          )}
          <div className="border-t border-gray-500 my-1 mx-1"></div>
        </>
      )}
  
      <div className="px-3 py-1.5 hover:bg-gray-600 cursor-pointer" onClick={() => handleMenuAction('rename')}>Rename</div>
      <div className="px-3 py-1.5 hover:bg-gray-600 hover:text-red-400 cursor-pointer text-red-500" onClick={() => handleMenuAction('delete')}>Delete</div>
    </>
  );

  return (
    <div style={{ paddingLeft: `${nestingLevel * 16}px` }} // Increased indent slightly
         className={`select-none ${isDragging ? 'opacity-40' : ''}`} 
         ref={itemDragRef}>
      <div
        ref={itemDivRef}
        onContextMenu={handleRightClick}
        onClick={handleClick}
        className={`flex items-center justify-between py-1 px-1.5 rounded group hover:bg-gray-700 active:bg-gray-600
                    ${isOver && canDrop ? 'bg-blue-600 bg-opacity-20 border border-blue-500' : ''}
                    ${onSelectFile && file.type !== 'folder' ? 'cursor-pointer' : 'cursor-default'} 
                    ${file.type === 'folder' ? 'cursor-pointer' : ''}`}
      >
        <div className="flex items-center truncate min-w-0 flex-1" >
          {getFileIcon()}
          {isRenaming ? (
            <input
              ref={fileNameInputRef} type="text" value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={handleRenameSubmit} onKeyDown={handleRenameKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-600 text-gray-100 border border-gray-500 rounded px-1 py-0.5 text-sm w-full outline-none focus:ring-1 focus:ring-blue-400 h-[22px]" // Fixed height
            />
          ) : (
            <span className="text-sm text-gray-300 group-hover:text-white truncate">{file.name}</span>
          )}
        </div>
        
        <button
          ref={threeDotButtonRef}
          onClick={toggleThreeDotMenu}
          className="p-1 text-gray-400 hover:text-gray-200 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded hover:bg-gray-600"
        >
          <FaEllipsisH size={14} />
        </button>
        
        {showThreeDotMenu && (
          <div
            ref={menuRef}
            className="fixed bg-gray-750 border border-gray-600 rounded shadow-xl z-20 py-1 w-40 text-gray-200 text-sm"
            style={{ top: `${contextMenuPosition.y}px`, left: `${contextMenuPosition.x}px`}}
            onClick={(e) => e.stopPropagation()}
          >
            {renderContextMenuItems()}
          </div>
        )}
      </div>

      {showRightClickMenu && (
        <div
          ref={menuRef}
          className="fixed bg-gray-750 border border-gray-600 rounded shadow-xl z-50 py-1 w-48 text-gray-200 text-sm"
          style={{ top: `${contextMenuPosition.y}px`, left: `${contextMenuPosition.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          {renderContextMenuItems()}
        </div>
      )}

      {/* This FileItem does not render its children directly. FileTree handles recursion. */}
      {/* The childrenToRender prop (if passed) would be used here if FileItem rendered children */}
      {isExpanded && file.type === 'folder' && childrenToRender}
    </div>
  );
};

export default FileItem;