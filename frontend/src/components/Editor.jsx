import React from 'react';
import MonacoEditor from 'react-monaco-editor';

const Editor = ({ code, setCode, theme = 'vs-dark', language, setLanguage }) => {
  // ... (your existing Editor component code is fine) ...
  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Top Bar with Language Dropdown */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-[#3c3c3c] text-sm">
        <div className="flex items-center">
          <label htmlFor="language" className="text-gray-400 mr-2">
            Language:
          </label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-[#3c3c3c] text-white border border-[#555] rounded-sm px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
            <option value="json">JSON</option>
            <option value="markdown">Markdown</option>
            <option value="plaintext">Plain Text</option>
            {/* Add other languages supported by Monaco & your backend */}
          </select>
        </div>
        {/* You could add Save button, etc. here */}
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 overflow-hidden h-full"> {/* Ensure h-full for Monaco to take height */}
        <MonacoEditor
          height="100%" // Explicit height can sometimes help
          language={language}
          theme={theme}
          value={code}
          onChange={setCode}
          options={{
            fontSize: 14,
            fontFamily: "'Fira Code', monospace, Menlo, Monaco, 'Courier New'", // Added fallbacks
            wordWrap: 'on',
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            tabSize: 2,
            automaticLayout: true, // Crucial for responsiveness
            lineNumbers: 'on',
            formatOnType: true,
            formatOnPaste: true,
            // Consider adding:
            // selectOnLineNumbers: true,
            // roundedSelection: false,
            // readOnly: false, // if you need a read-only mode
            // glyphMargin: true,
          }}
        />
      </div>
    </div>
  );
};

export default Editor;