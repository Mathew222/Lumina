import { useEffect, useState, useRef, useCallback } from 'react';
import { BROADCAST_CHANNEL_NAME } from '../utils/broadcast';

// Style settings type
interface StyleSettings {
    fontSize: 'sm' | 'md' | 'lg' | 'xl';
    showBackground: boolean;
    textColor: string;
}

// Max characters before clearing (approximately 2 lines at full width)
const MAX_DISPLAY_CHARS = 180;

export const SubtitlePopup = () => {
    const [displayText, setDisplayText] = useState('');
    const [interim, setInterim] = useState('');
    const [style, setStyle] = useState<StyleSettings>({
        fontSize: 'md',
        showBackground: true,
        textColor: '#ffffff',
    });

    const fullTextRef = useRef('');
    const lastClearPointRef = useRef(0);

    // When text exceeds limit, clear display and start fresh from that point
    const updateDisplayText = useCallback((newText: string) => {
        fullTextRef.current = newText;

        // Calculate text since last clear
        const textSinceLastClear = newText.slice(lastClearPointRef.current);

        if (textSinceLastClear.length <= MAX_DISPLAY_CHARS) {
            setDisplayText(textSinceLastClear);
        } else {
            // Clear and start fresh - find a good break point
            const breakPoint = newText.lastIndexOf(' ', newText.length - 10);
            lastClearPointRef.current = breakPoint > lastClearPointRef.current ? breakPoint + 1 : newText.length;
            setDisplayText(newText.slice(lastClearPointRef.current));
        }
    }, []);

    useEffect(() => {
        const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

        channel.onmessage = (event) => {
            if (event.data.type === 'TRANSCRIPT') {
                const { text: newText, interim: newInterim, style: newStyle } = event.data.payload;
                updateDisplayText(newText);
                setInterim(newInterim);
                if (newStyle) {
                    setStyle(newStyle);
                }
            }
        };

        // Apply transparent background for overlay
        document.body.style.backgroundColor = 'transparent';
        document.body.style.overflow = 'hidden';

        return () => {
            channel.close();
        };
    }, [updateDisplayText]);

    useEffect(() => {
        if (window.electron) {
            const cleanup = window.electron.onTranscriptUpdate((data) => {
                updateDisplayText(data.text);
                setInterim(data.interim);
                if (data.style) {
                    setStyle(data.style);
                }
            });
            return cleanup;
        }
    }, [updateDisplayText]);

    return (
        <div
            className="fixed top-0 left-0 right-0 w-screen px-12 py-4"
            style={{
                backgroundColor: style.showBackground ? 'rgba(0,0,0,0.85)' : 'transparent',
                minHeight: '60px'
            }}
        >
            {/* Single line display - all text together */}
            <p
                className="text-lg md:text-xl font-sans font-medium leading-relaxed"
                style={{ color: style.textColor }}
            >
                {displayText}
                {displayText && interim && ' '}
                {interim && <span className="italic opacity-70">{interim}</span>}
                {!displayText && !interim && <span className="text-gray-500 text-sm">Listening...</span>}
            </p>
        </div>
    );
};
