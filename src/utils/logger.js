const logs = [];
const MAX_LOGS = 100;

function addLog(type, args) {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const entry = {
    time: new Date().toISOString(),
    type,
    message
  };
  
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.shift(); // Remove o mais antigo
  }
}

// Guarda as funções originais
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

// Intercepta
console.log = (...args) => {
  addLog('info', args);
  originalLog.apply(console, args);
};

console.warn = (...args) => {
  addLog('warn', args);
  originalWarn.apply(console, args);
};

console.error = (...args) => {
  addLog('error', args);
  originalError.apply(console, args);
};

module.exports = {
  getLogs: () => logs
};
