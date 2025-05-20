import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from '../utils/axios';

// Fetch all files
export const fetchFiles = createAsyncThunk('files/fetchFiles', async (_, thunkAPI) => {
  try {
    const response = await axios.get('/files');
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || 'Failed to fetch files';
    return thunkAPI.rejectWithValue({ message });
  }
});

// Create a new file or folder
export const createFile = createAsyncThunk('files/createFile', async (fileData, thunkAPI) => {
  try {
    const response = await axios.post('/files', fileData);
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || 'Failed to create file/folder';
    return thunkAPI.rejectWithValue({ message });
  }
});

// Move a file or folder
export const moveFile = createAsyncThunk('files/moveFile', async ({ draggedId, targetId }, thunkAPI) => {
  try {
    const response = await axios.put(`/files/move`, { draggedId, targetId });
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || 'Failed to move file/folder';
    return thunkAPI.rejectWithValue({ message });
  }
});

// Rename a file or folder
export const renameFile = createAsyncThunk('files/renameFile', async ({ fileId, newName }, thunkAPI) => {
  try {
    const response = await axios.put(`/files/${fileId}`, { name: newName });
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || 'Failed to rename file/folder';
    return thunkAPI.rejectWithValue({ message });
  }
});

// Delete a file or folder
export const deleteFile = createAsyncThunk('files/deleteFile', async (fileId, thunkAPI) => {
  try {
    await axios.delete(`/files/${fileId}`);
    return fileId;
  } catch (error) {
    const message = error.response?.data?.message || 'Failed to delete file/folder';
    return thunkAPI.rejectWithValue({ message });
  }
});

const fileSlice = createSlice({
  name: 'files',
  initialState: {
    files: [],
    loading: false,
    error: null,
  },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchFiles.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchFiles.fulfilled, (state, action) => {
        state.loading = false;
        state.files = action.payload;
      })
      .addCase(fetchFiles.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload.message;
      })
      .addCase(createFile.fulfilled, (state, action) => {
        state.files.push(action.payload);
      })
      .addCase(moveFile.fulfilled, (state, action) => {
        const movedFile = action.payload;
        const removeFile = (files, id) => files.filter((file) => file._id !== id);
        const addFile = (files, file) => {
          if (file.parentId === null) {
            return [...files, file];
          }
          return files.map((f) =>
            f._id === file.parentId
              ? { ...f, children: addFile(f.children || [], file) }
              : { ...f, children: f.children ? addFile(f.children, file) : [] }
          );
        };
        state.files = addFile(removeFile(state.files, movedFile._id), movedFile);
      })
      .addCase(renameFile.fulfilled, (state, action) => {
        const renamedFile = action.payload;
        const updateFile = (files, file) =>
          files.map((f) =>
            f._id === file._id
              ? { ...f, name: file.name }
              : { ...f, children: f.children ? updateFile(f.children, file) : [] }
          );
        state.files = updateFile(state.files, renamedFile);
      })
      .addCase(deleteFile.fulfilled, (state, action) => {
        const deletedId = action.payload;
        const removeFile = (files, id) =>
          files.filter((file) => file._id !== id).map((file) => ({
            ...file,
            children: file.children ? removeFile(file.children, id) : [],
          }));
        state.files = removeFile(state.files, deletedId);
      });
  },
});

export default fileSlice.reducer;