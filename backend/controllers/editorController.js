export const setupEditorSocket = (io) => {
    const editorNamespace = io.of('/editor');
  
    editorNamespace.on('connection', (socket) => {
      console.log('Editor client connected:', socket.id);
  
      socket.on('codeChange', (code) => {
        socket.broadcast.emit('codeChange', code);
      });
  
      socket.on('disconnect', () => {
        console.log('Editor client disconnected:', socket.id);
      });
    });
  };
  