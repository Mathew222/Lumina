import { useEffect, useRef } from 'react';
import { Mic, MicOff, ExternalLink, Settings } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { BROADCAST_CHANNEL_NAME, sendMessage } from '../utils/broadcast';

export const Dashboard = () => {
    const { text, interimText, isListening, startListening, stopListening, hasSupport, error } = useSpeechRecognition();
    const channelRef = useRef<BroadcastChannel | null>(null);

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

    if (!hasSupport) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
                <div className="p-8 bg-red-900/50 rounded-xl border border-red-500">
                    <h1 className="text-2xl font-bold mb-2">Browser Not Supported</h1>
                    <p>Your browser does not support the Web Speech API. Please use Google Chrome.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 text-white p-8 font-sans">
            <div className="max-w-4xl mx-auto">
                <header className="flex justify-between items-center mb-12">
                    <div>
                        <h1 className="text-3xl font-extrabold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                            Live Subtitles
                        </h1>
                        <p className="text-gray-400 mt-1">Real-time speech-to-text overlay</p>
                    </div>
                    <div className="flex gap-4">
                        <button
                            onClick={openPopup}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors border border-gray-700"
                        >
                            <ExternalLink size={18} />
                            <span>Open Popup</span>
                        </button>
                        <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white">
                            <Settings size={24} />
                        </button>
                    </div>
                </header>

                <main className="grid gap-8">
                    {/* Controls */}
                    <div className="flex justify-center">
                        <button
                            onClick={isListening ? stopListening : startListening}
                            className={`
                        group relative flex items-center gap-3 px-8 py-4 rounded-full text-xl font-bold transition-all duration-300
                        ${isListening
                                    ? 'bg-red-500 hover:bg-red-600 shadow-[0_0_20px_rgba(239,68,68,0.5)]'
                                    : 'bg-indigo-600 hover:bg-indigo-500 shadow-[0_0_20px_rgba(79,70,229,0.5)]'
                                }
                    `}
                        >
                            {isListening ? (
                                <>
                                    <MicOff className="animate-pulse" /> Stop Listening
                                </>
                            ) : (
                                <>
                                    <Mic /> Start Listening
                                </>
                            )}
                        </button>
                    </div>

                    {/* Preview Window */}
                    <div className="bg-gray-900/50 rounded-2xl p-8 border border-gray-800 min-h-[300px] shadow-inner relative overflow-hidden">
                        <div className="absolute top-4 left-4 text-xs font-semibold text-gray-500 uppercase tracking-widest">
                            Preview
                        </div>

                        <div className="mt-8 text-center">
                            {error ? (
                                <div className="p-4 bg-red-900/40 text-red-200 rounded-lg inline-block border border-red-500/50">
                                    <p className="font-bold">Error: {error}</p>
                                    <p className="text-sm mt-1">Please ensure your microphone is connected and allowed.</p>
                                    {error === 'network' && <p className="text-xs mt-1 text-red-300">Network error: Web Speech API requires internet connection.</p>}
                                </div>
                            ) : text || interimText ? (
                                <p className="text-3xl leading-relaxed font-medium">
                                    <span className="text-white">{text}</span>
                                    <span className="text-gray-500 italic ml-1">{interimText}</span>
                                </p>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-48 text-gray-600">
                                    <p className="mb-2">Ready to transcribe...</p>
                                    <p className="text-sm">Click "Start Listening" and speak into your microphone.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
};
