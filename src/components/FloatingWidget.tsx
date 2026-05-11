import { useEffect, useState, useRef } from 'react';
import { Mic, Globe, Circle, Square, Maximize2, ChevronDown, MonitorUp } from 'lucide-react';
import { BROADCAST_CHANNEL_NAME, sendMessage } from '../utils/broadcast';
import { LANGUAGES } from '../utils/translate';
import type { SupportedLanguage } from '../utils/translate';

export const FloatingWidget = () => {
    const [isListening, setIsListening] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [targetLanguage, setTargetLanguage] = useState<SupportedLanguage>('en');
    const channelRef = useRef<BroadcastChannel | null>(null);

    useEffect(() => {
        channelRef.current = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

        channelRef.current.onmessage = (event) => {
            if (event.data.type === 'APP_STATE') {
                const { isListening: newIsListening, isRecording: newIsRecording, targetLanguage: newTargetLanguage } = event.data.payload;
                setIsListening(newIsListening);
                setIsRecording(newIsRecording);
                setTargetLanguage(newTargetLanguage);
            }
        };

        // Apply styling for widget window
        document.body.style.backgroundColor = 'transparent';
        document.body.style.overflow = 'hidden';

        return () => {
            channelRef.current?.close();
        };
    }, []);

    const toggleListening = () => {
        if (channelRef.current) {
            sendMessage(channelRef.current, 'WIDGET_COMMAND', { command: 'TOGGLE_LISTENING' });
        }
    };

    const toggleRecording = () => {
        if (channelRef.current) {
            sendMessage(channelRef.current, 'WIDGET_COMMAND', { command: 'TOGGLE_RECORDING' });
        }
    };

    const changeLanguage = (lang: SupportedLanguage) => {
        setTargetLanguage(lang);
        if (channelRef.current) {
            sendMessage(channelRef.current, 'WIDGET_COMMAND', { command: 'SET_LANGUAGE', value: lang });
        }
    };

    const openMainWindow = () => {
        if (window.electron) {
            window.electron.showMainWindow();
        }
    };

    const toggleOverlay = () => {
        if (window.electron) {
            window.electron.toggleOverlay();
        }
    };

    const currentLanguage = LANGUAGES.find(l => l.code === targetLanguage);

    return (
        <div 
            className="flex items-center justify-between px-4 py-3 bg-gray-900/95 backdrop-blur-xl border border-gray-700/60 rounded-3xl shadow-2xl text-white font-mono select-none w-full h-full"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
            {/* Drag Handle & Status */}
            <div className="flex items-center gap-3">
                <div 
                    onClick={toggleListening}
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    className={`w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-all ${
                        isListening ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50' : 'bg-gray-800 text-gray-500 border border-gray-700 hover:bg-gray-700'
                    }`}
                >
                    <Mic className={`w-5 h-5 ${isListening ? 'animate-pulse' : ''}`} />
                </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                {/* Language Selector (Native Select to prevent clipping) */}
                <div className="relative flex items-center bg-gray-800/80 border border-gray-700 rounded-full pl-3 pr-2 py-2 hover:bg-gray-700/80 transition-colors">
                    <Globe className="w-4 h-4 text-gray-400 mr-2" />
                    <select
                        value={targetLanguage}
                        onChange={(e) => changeLanguage(e.target.value as SupportedLanguage)}
                        className="appearance-none bg-transparent text-white text-xs font-bold tracking-widest outline-none pr-6 cursor-pointer uppercase"
                    >
                        {LANGUAGES.map(lang => (
                            <option key={lang.code} value={lang.code} className="bg-gray-900 text-white normal-case">
                                {lang.nativeName}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="w-3 h-3 text-gray-400 absolute right-3 pointer-events-none" />
                </div>

                {/* Record Button */}
                <button
                    onClick={toggleRecording}
                    className={`flex items-center justify-center w-10 h-10 rounded-full transition-all border ${
                        isRecording 
                            ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30' 
                            : 'bg-gray-800 border-purple-500/30 text-purple-400 hover:bg-purple-500/20 hover:border-purple-500/50'
                    }`}
                    title="Toggle Recording"
                >
                    {isRecording ? <Square className="w-4 h-4 fill-red-400" /> : <Circle className="w-4 h-4 fill-purple-400" />}
                </button>

                {/* Toggle Overlay Button */}
                <button
                    onClick={toggleOverlay}
                    className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-800 border border-gray-700 text-cyan-400 hover:text-cyan-300 hover:bg-gray-700 hover:border-gray-500 transition-all"
                    title="Toggle Subtitle Overlay"
                >
                    <MonitorUp className="w-4 h-4" />
                </button>

                {/* Expand Button */}
                <button
                    onClick={openMainWindow}
                    className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700 hover:border-gray-500 transition-all"
                    title="Open Main Window"
                >
                    <Maximize2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};
