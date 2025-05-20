import File from '../models/fileModel.js'; // Adjust path as needed
import mongoose from 'mongoose';

/**
 * Checks if a logged-in user has permission to access/modify a project.
 * @param {string} loggedInUserId - The ID of the currently authenticated user.
 * @param {string} projectOwnerId - The ID of the user who owns the project.
 * @param {string} projectSlug - The name/slug of the project.
 * @param {'read' | 'write'} requiredPermission - The minimum permission level required.
 * @returns {Promise<boolean>} - True if authorized, false otherwise.
 * @throws {Error} - If project not found.
 */
export const checkProjectPermission = async (loggedInUserId, projectOwnerId, projectSlug, requiredPermission) => {
  if (!loggedInUserId || !projectOwnerId || !projectSlug) {
    console.warn("AUTH_CHECK: Missing IDs or slug for permission check.");
    return false; // Or throw an error
  }

  // If the logged-in user is the owner, they always have permission.
  if (loggedInUserId.toString() === projectOwnerId.toString()) {
    return true;
  }

  // Find the project's root VFS document to check its 'sharedWith' array.
  // The project is identified by its owner and its name (slug).
  const projectRootVfs = await File.findOne({
    userId: projectOwnerId,
    name: projectSlug,
    parentId: null,
    type: 'folder',
    isTemplate: false      
  }).select('sharedWith').lean();

  if (!projectRootVfs) {

    console.warn(`AUTH_CHECK: Project VFS root not found for owner ${projectOwnerId}, slug ${projectSlug}.`);
    throw new Error(`Project "${projectSlug}" not found or not accessible.`);
  }

  const shareEntry = projectRootVfs.sharedWith.find(
    (s) => s.user.toString() === loggedInUserId.toString()
  );

  if (!shareEntry) {
    console.log(`AUTH_CHECK: User ${loggedInUserId} not directly shared on project ${projectSlug} (Owner: ${projectOwnerId}).`);
    return false; // Not shared with this user
  }

  // Check permission level
  if (requiredPermission === 'read' && (shareEntry.permission === 'read' || shareEntry.permission === 'write')) {
    return true; // 'write' permission also implies 'read'
  }
  if (requiredPermission === 'write' && shareEntry.permission === 'write') {
    return true;
  }

  console.log(`AUTH_CHECK: User ${loggedInUserId} has "${shareEntry.permission}" but needs "${requiredPermission}" for project ${projectSlug}.`);
  return false;
};