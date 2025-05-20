import mongoose from 'mongoose';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import File from '../models/fileModel.js'; // Adjust path: e.g., ../src/models/fileModel.js
import connectDB from '../config/db.js';   // Adjust path: e.g., ../src/config/db.js

// Assuming this script is in backend/scripts/ and .env is in backend/
dotenv.config({ path: path.resolve(process.cwd(), '.env') }); 

const TEMPLATES_BASE_DIR = path.resolve(process.cwd(), 'system_templates'); 

const TEMPLATE_DEFINITIONS = [
  {
    name: "React + Vite (TypeScript)",
    folderName: "React-Vite-TS", // This MUST match the folder name in system_templates/
    details: {
      description: "A minimal Vite project with React and TypeScript.",
      icon: "react",
      defaultEnvironment: "javascript", // Or 'node' if your LANGUAGE_IMAGES map uses 'node'
      tags: ["react", "vite", "typescript", "frontend"]
    }
  },
  {
    name: "Node.js Express Basic",
    folderName: "Node-Express-Basic",
    details: {
      description: "A simple Express.js server setup.",
      icon: "node",
      defaultEnvironment: "javascript", // Or 'node'
      tags: ["nodejs", "express", "backend"]
    }
  },
  {
    name: "Python Flask Simple",
    folderName: "Python-Flask-Simple",
    details: {
        description: "A basic Flask application structure.",
        icon: "python",
        defaultEnvironment: "python",
        tags: ["python", "flask", "backend"]
    }
  }
];

async function seedDirectory(dirPathOnHost, targetVfsParentId, templateType, baseTemplateDirForRelativePathLogging) {
  const entries = await fs.readdir(dirPathOnHost, { withFileTypes: true });

  for (const entry of entries) {
    const currentEntryHostPath = path.join(dirPathOnHost, entry.name);
    const loggedRelativePath = path.relative(baseTemplateDirForRelativePathLogging, currentEntryHostPath);

    if (['node_modules', '.git', '.DS_Store', '__pycache__', '.env', 'dist', 'build'].includes(entry.name) || entry.name.startsWith('~$')) {
        console.log(`  Skipping ignored entry: ${loggedRelativePath}`);
        continue;
    }
    
    const fileData = {
      name: entry.name,
      type: entry.isDirectory() ? 'folder' : 'file',
      content: '', // Default empty, will be filled for files
      parentId: targetVfsParentId,
      userId: null, 
      isTemplate: true,
      templateType: templateType,
    };

    if (entry.isFile()) {
        try {
            fileData.content = await fs.readFile(currentEntryHostPath, 'utf8');
        } catch (readError) {
            console.warn(`  Warning: Could not read file content for ${loggedRelativePath}. Storing as empty. Error: ${readError.message}`);
            fileData.content = `/* Error reading template file: ${entry.name} */`;
        }
    }
    
    const newFileDoc = new File(fileData);
    try {
        await newFileDoc.save();
        console.log(`  Created VFS ${fileData.type}: "${fileData.name}" (under parent ID: ${targetVfsParentId || 'ROOT TEMPLATE FOLDER'})`);
        if (entry.isDirectory()) {
            await seedDirectory(currentEntryHostPath, newFileDoc._id, templateType, baseTemplateDirForRelativePathLogging);
        }
    } catch (saveError) {
        console.error(`  Error saving VFS entry for "${fileData.name}": `, saveError.message);
        if (saveError.code === 11000) { // Duplicate key error
            console.warn(`  Skipping duplicate entry for "${fileData.name}" under parent "${targetVfsParentId}". This might happen if script is re-run without proper cleanup.`);
        }
    }
  }
}

const runSeed = async () => {
  try {
    await connectDB();
    console.log("MongoDB Connected for seeding templates...");

    for (const templateDef of TEMPLATE_DEFINITIONS) {
      console.log(`\nProcessing template definition: "${templateDef.name}" (from host folder: "${templateDef.folderName}")...`);

      let templateRootDoc = await File.findOne({
        name: templateDef.name,
        isTemplate: true,
        templateType: 'system',
        parentId: null,
        type: 'folder'
      });

      if (templateRootDoc) {
        console.log(`Template root "${templateDef.name}" already exists (ID: ${templateRootDoc._id}).`);
        // Simple "skip if exists" strategy. For update, you'd delete children then root, then re-add.
        // This is safer to prevent accidental data loss on re-runs without specific update logic.
        console.log("To re-seed, manually delete this template root from MongoDB first or implement update logic.");
        continue; 
      } else {
        const templateRootData = {
          name: templateDef.name,
          type: 'folder',
          parentId: null,
          userId: null,
          isTemplate: true,
          templateType: 'system',
          templateDetails: templateDef.details,
        };
        templateRootDoc = new File(templateRootData);
        await templateRootDoc.save();
        console.log(`Created root template folder in VFS: "${templateDef.name}" (ID: ${templateRootDoc._id})`);
      }

      const templateSourcePathOnHost = path.join(TEMPLATES_BASE_DIR, templateDef.folderName);
      if (existsSync(templateSourcePathOnHost)) {
        console.log(`  Seeding directory contents from host path: ${templateSourcePathOnHost}`);
        await seedDirectory(templateSourcePathOnHost, templateRootDoc._id, 'system', templateSourcePathOnHost);
      } else {
        console.warn(`  WARNING: Source directory NOT FOUND on host for template "${templateDef.name}" at: ${templateSourcePathOnHost}`);
      }
    }

    console.log('\nTemplate seeding process complete!');
  } catch (error) {
    console.error('FATAL ERROR during template seeding:', error);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('MongoDB disconnected.');
    }
  }
};

runSeed();