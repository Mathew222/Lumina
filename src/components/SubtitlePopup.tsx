import { useEffect, useState } from 'react';
import { BROADCAST_CHANNEL_NAME } from '../utils/broadcast';

// Style settings type
interface StyleSettings {
    fontSize: 'sm' | 'md' | 'lg' | 'xl';
    showBackground: boolean;
    textColor: string;
}

// Font size classes matching Dashboard
const FONT_SIZES = {
    sm: 'text-2xl md:text-3xl',
    md: 'text-3xl md:text-4xl',
    lg: 'text-4xl md:text-5xl',
    xl: 'text-5xl md:text-6xl',
};

export const SubtitlePopup = () => {
    const [text, setText] = useState('');
    const [interim, setInterim] = useState('');
    const [style, setStyle] = useState<StyleSettings>({
        fontSize: 'md',
        showBackground: true,
        textColor: '#ffffff',
    });

    useEffect(() => {
        const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

        channel.onmessage = (event) => {
            if (event.data.type === 'TRANSCRIPT') {
                const { text: newText, interim: newInterim, style: newStyle } = event.data.payload;
                setText(newText);
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
    }, []);

    useEffect(() => {
        if (window.electron) {
            const cleanup = window.electron.onTranscriptUpdate((data) => {
                setText(data.text);
                setInterim(data.interim);
                if (data.style) {
                    setStyle(data.style);
                }
            });
            return cleanup;
        }
    }, []);

    return (
        <div
            className="flex items-end justify-center h-screen w-screen p-4 pb-12"
            style={{ backgroundColor: style.showBackground ? 'rgba(0,0,0,0.8)' : 'transparent' }}
        >
            <div className="text-center max-w-5xl">
                <p
                    className={`${FONT_SIZES[style.fontSize]} font-sans font-bold drop-shadow-lg transition-all duration-150 ease-out leading-relaxed`}
                    style={{ color: style.textColor }}
                >
                    {text}
                    {interim && (
                        <span
                            className="ml-2 italic animate-pulse opacity-70"
                            style={{ color: style.textColor }}
                        >
                            {interim}
                        </span>
                    )}
                    {!text && !interim && (
                        <span className="text-gray-600 text-2xl">Listening for audio...</span>
                    )}
                </p>
            </div>
        </div>
    );
};
