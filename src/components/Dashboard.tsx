import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { BROADCAST_CHANNEL_NAME, sendMessage } from '../utils/broadcast';

export const Dashboard = () => {
    const { text, interimText, isListening, startListening, stopListening, error, audioLevel } = useSpeechRecognition();
    const channelRef = useRef<BroadcastChannel | null>(null);

    // Debug Console State
    const [logs, setLogs] = useState<string[]>([]);

    useEffect(() => {
        // Hook into console.log to capture logs on screen
        const originalLog = console.log;
        const originalError = console.error;

        console.log = (...args) => {
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
            setLogs(prev => [msg, ...prev].slice(0, 10)); // Keep last 10 logs
            originalLog(...args);
        };
        console.error = (...args) => {
            const msg = "ERR: " + args.map(a => String(a)).join(' ');
            setLogs(prev => [msg, ...prev].slice(0, 10));
            originalError(...args);
        };

        return () => {
            console.log = originalLog;
            console.error = originalError;
        };
    }, []);

    useEffect(() => {
        channelRef.current = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        return () => {
            channelRef.current?.close();
        };
    }, []);

    useEffect(() => {
        if (channelRef.current) {
            sendMessage(channelRef.current, 'TRANSCRIPT', { text, interim: interimText });
        }
        if (window.electron) {
            window.electron.sendTranscript({ text, interim: interimText });
        }
    }, [text, interimText]);

    const openPopup = () => {
        if (window.electron) {
            window.electron.toggleOverlay();
        } else {
            window.open(
                window.location.origin + '?mode=popup',
                'SubtitlePopup',
                'width=800,height=200,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no'
            );
        }
    };

    const toggleListening = () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    };

    return (
        <div className="h-screen bg-black text-white font-mono flex flex-col justify-between p-8 overflow-hidden select-none">
            {/* Header */}
            <header className="flex justify-between items-start">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-900 rounded-2xl flex items-center justify-center border border-gray-800 relative overflow-hidden">
                        {/* Audio Level Background */}
                        <div
                            className="absolute bottom-0 left-0 right-0 bg-purple-500/20 transition-all duration-75"
                            style={{ height: `${audioLevel}%` }}
                        ></div>
                        <Mic className={`w-6 h-6 z-10 ${isListening ? 'text-purple-500 animate-pulse' : 'text-gray-500'}`} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-wider text-white">LUMINA</h1>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`}></span>
                            <span className="text-xs text-gray-500 uppercase tracking-widest">
                                {isListening ? 'LISTENING' : 'IDLE'}
                                {isListening && <span className="text-gray-600 ml-2">VOL: {audioLevel}</span>}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={openPopup}
                        className="px-6 py-2 rounded-full border border-gray-800 text-xs font-bold tracking-widest text-gray-400 hover:text-white hover:border-gray-600 transition-all uppercase"
                    >
                        Overlay View
                    </button>
                    <button
                        onClick={toggleListening}
                        className="px-6 py-2 rounded-full bg-white text-black text-xs font-bold tracking-widest hover:bg-gray-200 transition-all uppercase shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                    >
                        {isListening ? 'Stop Feed' : 'Launch Feed'}
                    </button>
                </div>
            </header>

            {/* Center Content / Visualizer */}
            <main className="flex flex-col items-center justify-center flex-1 relative w-full">
                {/* Debug Console Overlay */}
                <div className="absolute top-0 right-0 p-4 w-96 font-mono text-[10px] text-gray-500 pointer-events-none opacity-50 text-right">
                    {logs.map((log, i) => (
                        <div key={i} className="whitespace-pre-wrap mb-1">{log}</div>
                    ))}
                </div>

                {/* Error Toast */}
                {error && (
                    <div className="absolute top-0 mt-4 px-4 py-2 bg-red-900/80 border border-red-500/50 rounded-full flex items-center gap-2 backdrop-blur-sm animate-pulse z-50">
                        <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                        <span className="text-xs text-red-200 uppercase tracking-wider">{error}</span>
                    </div>
                )}

                {/* Visualizer - Reacts to Audio Level */}
                <div className={`flex items-end gap-2 h-16 mb-8 transition-all duration-500 ${isListening ? 'opacity-100 scale-100' : 'opacity-30 scale-90'}`}>
                    <div className="w-2 bg-purple-500 rounded-full transition-all duration-75" style={{ height: `${Math.max(8, audioLevel * 0.5)}px` }}></div>
                    <div className="w-2 bg-purple-500 rounded-full transition-all duration-75 delay-75" style={{ height: `${Math.max(12, audioLevel * 0.8)}px` }}></div>
                    <div className="w-2 bg-purple-500 rounded-full transition-all duration-75" style={{ height: `${Math.max(16, audioLevel * 1.2)}px` }}></div>
                    <div className="w-2 bg-purple-500 rounded-full transition-all duration-75 delay-75" style={{ height: `${Math.max(12, audioLevel * 0.9)}px` }}></div>
                    <div className="w-2 bg-purple-500 rounded-full transition-all duration-75" style={{ height: `${Math.max(8, audioLevel * 0.6)}px` }}></div>
                </div>

                <div className="text-center max-w-3xl px-8">
                    <p className={`text-gray-600 text-sm tracking-[0.2em] uppercase mb-4 transition-opacity ${isListening ? 'opacity-100' : 'opacity-50'}`}>
                        {error ? 'System Offline' : isListening ? 'Capturing Audio Stream' : 'System Idle'}
                    </p>
                    {/* Live Transcript Preview */}
                    <div className="min-h-[60px]">
                        {(text || interimText) ? (
                            <p className="text-xl md:text-2xl text-gray-300 font-sans leading-relaxed transition-all">
                                {text} <span className="text-purple-400 opacity-70 border-b border-purple-500/30">{interimText}</span>
                            </p>
                        ) : (
                            <p className="text-gray-800 italic font-serif">...</p>
                        )}
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="grid grid-cols-2 text-[10px] text-gray-600 tracking-widest uppercase border-t border-gray-900/50 pt-8">
                <div>
                    <h3 className="text-gray-500 mb-2 font-bold">Control</h3>
                    <div className="flex items-center gap-2">
                        <span className="border border-gray-700 px-2 py-1 rounded text-gray-400">ESC</span>
                        <span>Toggle Interface</span>
                    </div>
                </div>
                <div>
                    <h3 className="text-gray-500 mb-2 font-bold">Core</h3>
                    <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]"></span>
                        <span>Whisper Base (Local)</span>
                    </div>
                    <div className="mt-1 normal-case text-gray-700 tracking-normal">
                        Running offline inference.
                    </div>
                </div>
            </footer>
        </div>
    );
};
