// src/components/ProjectSelector.jsx
import React, { useState, useEffect, useCallback } from 'react';
import axios from '../utils/axios'; // Adjust path if needed
import { FaFolderPlus, FaSpinner, FaFolder, FaUsers, FaUserCircle, FaUserTag, FaCaretDown } from 'react-icons/fa'; // Added FaUsers

const ProjectSelector = ({ userId, onSelectProject, onSetLoading }) => {
  const [myProjects, setMyProjects] = useState([]);
  const [sharedProjects, setSharedProjects] = useState([]);
  const [templates, setTemplates] = useState([]); // System and User templates

  const [isLoadingMyProjects, setIsLoadingMyProjects] = useState(false);
  const [isLoadingSharedProjects, setIsLoadingSharedProjects] = useState(false);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [error, setError] = useState('');

  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);

  const fetchAllData = useCallback(async () => {
    if (!userId) return;

    setIsLoadingMyProjects(true);
    setIsLoadingSharedProjects(true);
    setIsLoadingTemplates(true);
    setError('');

    try {
      const [myProjectsRes, sharedProjectsRes, templatesRes] = await Promise.all([
        axios.get(`/vfs/projects`),      // Fetches projects owned by current user
        axios.get(`/vfs/projects/shared-with-me`), // Fetches projects shared with current user
        axios.get(`/vfs/templates`)      // Fetches { system: [], user: [] } templates
      ]);

      setMyProjects(myProjectsRes.data || []);
      setSharedProjects(sharedProjectsRes.data || []);
      setTemplates(templatesRes.data || { system: [], user: [] }); // Expect {system:[], user:[]}

    } catch (err) {
      console.error("ProjectSelector: Error fetching initial data:", err);
      const errorMessage = err.response?.data?.message || "Failed to load project data. Please try again.";
      setError(errorMessage);
      setMyProjects([]);
      setSharedProjects([]);
      setTemplates({ system: [], user: [] });
    } finally {
      setIsLoadingMyProjects(false);
      setIsLoadingSharedProjects(false);
      setIsLoadingTemplates(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const handleCreateNewProject = async (e) => {
    if (e) e.preventDefault();
    const trimmedName = newProjectName.trim();
    if (!trimmedName) { alert("Project name cannot be empty."); return; }
    if (trimmedName.includes('/') || trimmedName.includes('\\') || trimmedName.includes('..')) {
      alert('Project name cannot contain path separators (/, \\) or ".." characters.'); return;
    }

    onSetLoading(true); setError('');
    try {
      const response = await axios.post('/vfs/projects', {
        projectName: trimmedName,
        templateId: selectedTemplateId || null,
      });
      const newProject = response.data;

      // When a new project is created, it's owned by the current user
      onSelectProject({
        slug: newProject.name,
        vfsId: newProject._id,
        ownerId: userId, // Current user is the owner
        ownerUsername: null, // Not a shared project initially
        permissionForCurrentUser: 'write', // Owner has write permission
        isRootWorkspace: false,
        defaultEnvironment: newProject.defaultEnvironment
      });

      setShowNewProjectForm(false); setNewProjectName(''); setSelectedTemplateId(null);
      // fetchAllData(); // Re-fetch to include the new project in "My Projects"
    } catch (err) { /* ... error handling ... */ }
    finally { onSetLoading(false); }
  };

  const handleRootWorkspaceSelect = () => {
    if (!userId) return;
    onSelectProject({
      slug: userId.toString(), // Slug for host folder will be userId
      vfsId: null,
      ownerId: userId, // Current user is owner of their root workspace
      permissionForCurrentUser: 'write',
      isRootWorkspace: true,
      defaultEnvironment: 'shell'
    });
  };

  const isLoading = isLoadingMyProjects || isLoadingSharedProjects || isLoadingTemplates;
  const allSystemTemplates = templates.system || [];
  const allUserTemplates = templates.user || [];

  if (isLoading && myProjects.length === 0 && sharedProjects.length === 0 && allSystemTemplates.length === 0 && allUserTemplates.length === 0) {
    return (<div className="flex items-center justify-center h-full">
      <FaSpinner className="animate-spin text-blue-400 text-3xl" />
      <span className="text-gray-400 text-sm ml-2">Loading projects and templates...</span>
    </div>);
  }

  return (
    <div className="p-6 bg-gray-800 shadow-2xl rounded-lg max-w-2xl w-full border border-gray-700 animate-fadeIn"> {/* Increased max-w */}
      <h3 className="text-2xl mb-8 text-center text-gray-100 font-light tracking-wide">Open or Create Project</h3>

      {error && <p className="text-red-300 text-sm mb-4 bg-red-500 bg-opacity-20 p-3 rounded border border-red-500 border-opacity-30">{error}</p>}

      {/* Create New Project UI (same as before, using system and user templates) */}
      <div className="mb-6">
        {!showNewProjectForm ? (<button onClick={() => { setShowNewProjectForm(true); setSelectedTemplateId(null); setNewProjectName(''); }} /* ... */ > <FaFolderPlus className="mr-2" /> Create New Project </button>
        ) : (<form onSubmit={handleCreateNewProject} className="p-4 bg-gray-700 rounded-md space-y-4 shadow-lg border border-gray-600"> {/* ... form fields ... */}
          {/* Template Select Dropdown */}
          <div>
            <label htmlFor="templateSelect" className="block text-sm font-medium text-gray-300 mb-1">Start from Template (Optional):</label>
            {isLoadingTemplates ? <div className="text-gray-400 text-xs py-2"><FaSpinner className="animate-spin inline mr-1" />Loading templates...</div> :
              <div className="relative">
                <select id="templateSelect" value={selectedTemplateId || ""} onChange={(e) => setSelectedTemplateId(e.target.value || null)}
                  className="w-full p-2.5 appearance-none rounded-md bg-gray-600 border border-gray-500 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-colors cursor-pointer" >
                  <option value="">Blank Project</option>
                  {allSystemTemplates.length > 0 && <optgroup label="System Templates">
                    {allSystemTemplates.map(template => (
                      <option key={template._id} value={template._id} className="py-1 bg-gray-600 text-white">
                        {/* ... template icon logic ... */} {template.name} {template.description ? `- ${template.description}` : ''}
                      </option>
                    ))}
                  </optgroup>}
                  {allUserTemplates.length > 0 && <optgroup label="My Templates">
                    {allUserTemplates.map(template => (
                      <option key={template._id} value={template._id} className="py-1 bg-gray-600 text-white">
                        <FaUserTag className="inline mr-2 text-teal-400" /> {template.name} {template.description ? `- ${template.description}` : ''}
                      </option>
                    ))}
                  </optgroup>}
                </select>
                <FaCaretDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>}
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={() => { setShowNewProjectForm(false); setSelectedTemplateId(null); }} className="px-4 py-2 text-sm rounded-md bg-gray-500 hover:bg-gray-400 text-gray-100 transition-colors">Cancel</button>
            <button type="submit" disabled={isLoadingInitialData || (onSetLoading === undefined ? false : undefined)} // onSetLoading is actually setIsLoadingProject from parent
              className="px-4 py-2 text-sm rounded-md bg-green-600 hover:bg-green-700 text-white transition-colors disabled:opacity-50 flex items-center justify-center min-w-[100px]"
            >
              {isLoadingProjects || isLoadingTemplates ? <FaSpinner className="animate-spin" /> : "Create"}
            </button>
          </div>
        </form>)}
      </div>

      {(myProjects.length > 0 || sharedProjects.length > 0) && !showNewProjectForm && (
        <div className="border-t border-gray-700 my-6 opacity-50"></div>
      )}

      {!showNewProjectForm && (
        <div className="grid md:grid-cols-2 gap-6"> {/* Grid for My Projects and Shared Projects */}
          {/* My Projects Section */}
          <div>
            <h4 className="text-lg mb-3 text-gray-200 font-medium">My Projects</h4>
            {isLoadingMyProjects && <div className="text-center text-gray-400 py-3"><FaSpinner className="animate-spin inline text-blue-400" /></div>}
            {!isLoadingMyProjects && myProjects.length === 0 && <p className="text-gray-400 text-sm italic py-2">You haven't created any projects yet.</p>}
            {myProjects.length > 0 && (
              <ul className="space-y-1.5 max-h-48 overflow-y-auto bg-gray-750 p-3 rounded-md shadow-inner custom-scrollbar">
                {myProjects.map(p => (
                  <li key={p._id}
                    onClick={() => onSelectProject({
                      slug: p.name,
                      vfsId: p._id,
                      ownerId: userId, // Current user is the owner
                      permissionForCurrentUser: 'write',
                      isRootWorkspace: false,
                      defaultEnvironment: p.defaultEnvironment
                    })}
                    className="cursor-pointer flex items-center hover:bg-gray-600 p-2.5 rounded text-gray-200 hover:text-white transition-colors duration-150 ease-in-out group"
                  >
                    <FaFolder className="mr-3 text-lg text-yellow-500 group-hover:text-yellow-400 transition-colors" /> {p.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Shared With Me Section */}
          <div>
            <h4 className="text-lg mb-3 text-gray-200 font-medium">Shared With Me</h4>
            {isLoadingSharedProjects && <div className="text-center text-gray-400 py-3"><FaSpinner className="animate-spin inline text-blue-400" /></div>}
            {!isLoadingSharedProjects && sharedProjects.length === 0 && <p className="text-gray-400 text-sm italic py-2">No projects have been shared with you.</p>}
            {sharedProjects.length > 0 && (
              <ul className="space-y-1.5 max-h-48 overflow-y-auto bg-gray-750 p-3 rounded-md shadow-inner custom-scrollbar">
                {sharedProjects.map(p => ( // 'p' is a shared project object
                  <li key={p._id}
                    onClick={() => onSelectProject({
                      slug: p.name,
                      vfsId: p._id,
                      ownerId: p.owner._id, // ID of the user who owns and shared this
                      ownerUsername: p.owner.username, // For display
                      permissionForCurrentUser: p.permissionForCurrentUser,
                      isRootWorkspace: false,
                      defaultEnvironment: p.defaultEnvironment
                    })}
                    className="cursor-pointer flex items-center justify-between hover:bg-gray-600 p-2.5 rounded text-gray-200 hover:text-white transition-colors duration-150 ease-in-out group"
                  >
                    <div className="flex items-center">
                      <FaUsers className="mr-3 text-lg text-teal-400 group-hover:text-teal-300 transition-colors" /> {p.name}
                    </div>
                    <span className="text-xs text-gray-400 italic">by {p.owner.username}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {!showNewProjectForm && (
        <>
          <div className="border-t border-gray-700 my-6 opacity-50"></div>
          <button onClick={handleRootWorkspaceSelect} /* ... Open User Root Workspace button ... */ >
            Open User Root Workspace
          </button>
        </>
      )}
    </div>
  );
};
export default ProjectSelector;