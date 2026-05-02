"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSessions = loadSessions;
exports.saveSessions = saveSessions;
exports.addSession = addSession;
exports.removeSession = removeSession;
exports.renameSession = renameSession;
exports.updateSessionStatus = updateSessionStatus;
exports.getSession = getSession;
exports.getAllSessions = getAllSessions;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const STORE_DIR = path.join(os.homedir(), '.multi-claude');
const STORE_FILE = path.join(STORE_DIR, 'sessions.json');
function ensureStoreDir() {
    if (!fs.existsSync(STORE_DIR)) {
        fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
    }
}
function loadSessions() {
    ensureStoreDir();
    if (!fs.existsSync(STORE_FILE)) {
        return { version: 1, sessions: {} };
    }
    try {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        const bakFile = STORE_FILE + '.bak';
        try {
            fs.renameSync(STORE_FILE, bakFile);
            process.stderr.write(`Warning: ${STORE_FILE} is corrupted. Renamed to ${bakFile}. Starting with empty sessions.\n`);
        }
        catch {
            process.stderr.write(`Warning: ${STORE_FILE} is corrupted and could not be backed up. Starting with empty sessions.\n`);
        }
        return { version: 1, sessions: {} };
    }
}
function saveSessions(store) {
    ensureStoreDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
    fs.chmodSync(STORE_FILE, 0o600);
}
function addSession(state) {
    const store = loadSessions();
    store.sessions[state.name] = state;
    saveSessions(store);
}
function removeSession(name) {
    const store = loadSessions();
    if (!store.sessions[name])
        return false;
    delete store.sessions[name];
    saveSessions(store);
    return true;
}
function renameSession(oldName, newName) {
    const store = loadSessions();
    if (!store.sessions[oldName] || store.sessions[newName])
        return false;
    store.sessions[newName] = {
        ...store.sessions[oldName],
        name: newName,
        config: { ...store.sessions[oldName].config, name: newName },
    };
    delete store.sessions[oldName];
    saveSessions(store);
    return true;
}
function updateSessionStatus(name, status) {
    const store = loadSessions();
    if (store.sessions[name]) {
        store.sessions[name].status = status;
        saveSessions(store);
    }
}
function getSession(name) {
    const store = loadSessions();
    return store.sessions[name];
}
function getAllSessions() {
    const store = loadSessions();
    return Object.values(store.sessions);
}
