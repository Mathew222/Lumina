import { useEffect, useState } from 'react';
import { BROADCAST_CHANNEL_NAME } from '../utils/broadcast';

export const SubtitlePopup = () => {
    const [text, setText] = useState('');
    const [interim, setInterim] = useState('');

    useEffect(() => {
        const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

        channel.onmessage = (event) => {
            if (event.data.type === 'TRANSCRIPT') {
                const { text: newText, interim: newInterim } = event.data.payload;
                setText(newText);
                setInterim(newInterim);
            }
        };

        // Apply specific styles for the popup window to be transparent-ish
        document.body.style.backgroundColor = 'rgba(0,0,0,0.8)'; // Semi-transparent black
        document.body.style.overflow = 'hidden';

        return () => {
            channel.close();
        };
    }, []);

    useEffect(() => {
        if (window.electron) {
            const cleanup = window.electron.onTranscriptUpdate((data) => {
                setText(data.text);
                setInterim(data.interim);
            });
            return cleanup;
        }
    }, []);

    return (
        <div className="flex items-end justify-center h-screen w-screen p-4 pb-12">
            <div className="text-center">
                <p className="text-white text-4xl font-sans font-bold drop-shadow-md transition-all duration-150">
                    {text}
                    <span className="text-gray-300 ml-2 italic">{interim}</span>
                </p>
            </div>
        </div>
    );
};
