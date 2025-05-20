// src/components/ShareProjectModal.jsx
import React, { useState, useEffect } from 'react';
import { FaCaretDown, FaShareAlt, FaSpinner, FaTimes } from 'react-icons/fa';

const ShareProjectModal = ({ isActive, onClose, onShare, projectToShare, isLoading }) => {
  const [shareWithIdentifier, setShareWithIdentifier] = useState(''); // Email or Username of User B
  const [permissionLevel, setPermissionLevel] = useState('read'); // 'read' or 'write'
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (isActive) {
      setShareWithIdentifier('');
      setPermissionLevel('read');
      setError('');
      setSuccessMessage('');
    }
  }, [isActive]);

  if (!isActive || !projectToShare) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    if (!shareWithIdentifier.trim()) {
      setError("Please enter a username or email to share with.");
      return;
    }
    try {
      await onShare(projectToShare, shareWithIdentifier.trim(), permissionLevel);
      setSuccessMessage(`Project "${projectToShare.name}" shared successfully!`);
      // Optionally close modal after a delay or let user close
      // setTimeout(onClose, 2000); 
    } catch (err) {
      setError(err.message || "Failed to share project.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md text-white border border-gray-700 animate-slideUp">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-100">Share Project: <span className="text-indigo-400">{projectToShare.name}</span></h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <FaTimes size={20}/>
          </button>
        </div>

        {error && <p className="text-red-400 text-sm mb-3 bg-red-500 bg-opacity-20 p-2 rounded">{error}</p>}
        {successMessage && <p className="text-green-400 text-sm mb-3 bg-green-500 bg-opacity-20 p-2 rounded">{successMessage}</p>}
        
        {!successMessage && ( // Hide form after success to prevent resubmission
            <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="shareUserIdentifier" className="block text-sm font-medium text-gray-300 mb-1">Share with (Username or Email):</label>
                <input
                    id="shareUserIdentifier" type="text" value={shareWithIdentifier}
                    onChange={(e) => setShareWithIdentifier(e.target.value)}
                    className="w-full p-2.5 rounded-md bg-gray-700 border border-gray-600 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    required autoFocus
                />
            </div>
            <div>
                <label htmlFor="permissionLevel" className="block text-sm font-medium text-gray-300 mb-1">Permission Level:</label>
                <div className="relative">
                    <select
                        id="permissionLevel" value={permissionLevel}
                        onChange={(e) => setPermissionLevel(e.target.value)}
                        className="w-full p-2.5 appearance-none rounded-md bg-gray-700 border border-gray-600 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none cursor-pointer"
                    >
                        <option value="read">Read-only</option>
                        <option value="write">Read & Write</option>
                    </select>
                    <FaCaretDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none"/>
                </div>
            </div>
            <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md bg-gray-600 hover:bg-gray-500 text-gray-200 transition-colors">Cancel</button>
                <button type="submit" disabled={isLoading} className="px-4 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 flex items-center justify-center min-w-[100px]">
                    {isLoading ? <FaSpinner className="animate-spin"/> : <><FaShareAlt className="mr-2"/>Share</>}
                </button>
            </div>
            </form>
        )}
        {successMessage && (
            <div className="flex justify-end pt-4">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md bg-gray-600 hover:bg-gray-500 text-gray-200 transition-colors">Close</button>
            </div>
        )}
      </div>
    </div>
  );
};

export default ShareProjectModal;