// models/fileModel.js
import mongoose from 'mongoose';

const sharedUserSchema = new mongoose.Schema({
  user: { // The user with whom this item is shared
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  permission: { // Permission level for this user on this item
    type: String,
    enum: ['read', 'write'], // 'read' = read-only, 'write' = read & write
    default: 'read',
    required: true,
  }
}, { _id: false }); // Don't create a separate _id for subdocuments in array

const fileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ['file', 'folder'], required: true },
    content: { type: String, default: '' },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', default: null, index: true },
    
    // userId now clearly means the OWNER of this file/folder
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, 
    
    isTemplate: { type: Boolean, default: false, index: true },
    templateType: { 
        type: String, 
        enum: ['system', 'user'],
        required: function() { return this.isTemplate; }
    },
    templateDetails: {
        description: String,
        tags: [String],
        icon: String, 
        defaultEnvironment: String,
    },


    sharedWith: [sharedUserSchema], 
    isPublicForRead: { type: Boolean, default: false, index: true } // Optional: for public read-only links
    // ------------------------
  },
  { timestamps: true }
);

// Indexes
fileSchema.index({ userId: 1, parentId: 1, name: 1, type: 1 });
fileSchema.index({ isTemplate: 1, templateType: 1, name: 1, parentId: 1 });

// Unique project names per owner (root folders that are not templates)
fileSchema.index({ userId: 1, name: 1, parentId: null, type: 'folder', isTemplate: false }, { 
    unique: true, 
    partialFilterExpression: { parentId: null, type: 'folder', isTemplate: false } 
});

// Unique system template names
fileSchema.index({ name: 1, parentId: null, type: 'folder', isTemplate: true, templateType: 'system' }, { 
    unique: true, 
    partialFilterExpression: { parentId: null, type: 'folder', isTemplate: true, templateType: 'system' } 
});

// Index to help find projects shared with a user
fileSchema.index({ "sharedWith.user": 1, type: 'folder', parentId: null });


const File = mongoose.model('File', fileSchema);
export default File;