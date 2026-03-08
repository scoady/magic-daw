// ── Swift/WKWebView Bridge ──────────────────────────────────────────────────

type SwiftMessageHandler = (payload: unknown) => void;

const handlers: Map<string, Set<SwiftMessageHandler>> = new Map();

// Post message to Swift via WKWebView
export function sendToSwift(type: string, payload: unknown = {}): void {
  try {
    const webkit = (window as any).webkit;
    if (webkit?.messageHandlers?.magicDAW) {
      webkit.messageHandlers.magicDAW.postMessage({ type, payload });
    } else {
      console.debug('[Bridge] No Swift handler, message:', type, payload);
    }
  } catch (e) {
    console.warn('[Bridge] Failed to send:', type, e);
  }
}

// Register callback for Swift -> JS events
export function onSwiftMessage(type: string, callback: SwiftMessageHandler): () => void {
  if (!handlers.has(type)) {
    handlers.set(type, new Set());
  }
  handlers.get(type)!.add(callback);

  // Return unsubscribe function
  return () => {
    handlers.get(type)?.delete(callback);
  };
}

// Called by Swift to dispatch events to JS
(window as any).__magicDAWReceive = (type: string, payload: unknown) => {
  const typeHandlers = handlers.get(type);
  if (typeHandlers) {
    typeHandlers.forEach((handler) => handler(payload));
  }
};

// ── Message Types ──────────────────────────────────────────────────────────

export const BridgeMessages = {
  // JS -> Swift
  TRANSPORT_PLAY: 'transport_play',
  TRANSPORT_STOP: 'transport_stop',
  TRANSPORT_RECORD: 'transport_record',
  TRANSPORT_REWIND: 'transport_rewind',
  SET_BPM: 'set_bpm',
  SET_VOLUME: 'set_volume',
  SET_PAN: 'set_pan',
  MIDI_NOTE_ON: 'midi_note_on',
  MIDI_NOTE_OFF: 'midi_note_off',
  AI_REQUEST: 'ai_request',
  EXPORT_AU: 'export_au',
  SAVE_PROJECT: 'save_project',
  LOAD_PROJECT: 'load_project',

  // Swift -> JS
  MIDI_EVENT: 'midi_event',
  AUDIO_LEVELS: 'audio_levels',
  TRANSPORT_STATE: 'transport_state',
  AI_RESULT: 'ai_result',
  PROJECT_DATA: 'project_data',
  KEY_DETECTED: 'key_detected',
  OLLAMA_STATUS: 'ollama_status',
} as const;
