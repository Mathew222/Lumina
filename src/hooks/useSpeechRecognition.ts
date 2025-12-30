import { useState, useEffect, useRef } from 'react';

export interface UseSpeechRecognitionReturn {
    text: string;
    interimText: string;
    isListening: boolean;
    startListening: () => void;
    stopListening: () => void;
    hasSupport: boolean;
    error: string | null;
    audioLevel: number;
    isModelLoading: boolean;
    reloadModel: () => void;
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
    const [text, setText] = useState('');
    const [interimText, setInterimText] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);
    const [isModelLoading, setIsModelLoading] = useState(true);

    const workerRef = useRef<Worker | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const isProcessingRef = useRef(false);

    const [retryCount, setRetryCount] = useState(0);

    const isModelLoadingRef = useRef(isModelLoading);

    useEffect(() => {
        isModelLoadingRef.current = isModelLoading;
    }, [isModelLoading]);

    useEffect(() => {
        // Initialize Worker - using Vosk for low latency
        // Use regular worker (not module) since Vosk uses importScripts
        workerRef.current = new Worker(new URL('../workers/vosk.worker.js', import.meta.url));
        workerRef.current.onmessage = (event) => {
            const { type, text: resultText, error: resultError, message } = event.data;

            if (type === 'ready') {
                console.log('[Hook] Worker reported ready');
                setIsModelLoading(false);
                setError(null);
            } else if (type === 'debug') {
                console.log(`[Vosk Worker Debug] ${message}`);
            } else if (type === 'partial') {
                // Vosk provides partial results for very low latency
                if (resultText) {
                    const clean = resultText.trim();
                    if (clean.length > 0) {
                        setInterimText(clean);
                    }
                }
            } else if (type === 'result') {
                // Allow parallel processing - don't block immediately
                setTimeout(() => {
                    isProcessingRef.current = false;
                }, 50);
                
                if (resultText) {
                    const clean = resultText.trim();
                    if (clean.length > 0) {
                        // Fast live subtitles - simple append strategy
                        setText((prev) => {
                            if (!prev) {
                                return clean;
                            }
                            
                            // Quick check: if new text is much longer, replace
                            if (clean.length > prev.length * 1.3) {
                                return clean;
                            }
                            
                            // If new text contains most of previous, replace (refinement)
                            const prevLower = prev.toLowerCase();
                            const cleanLower = clean.toLowerCase();
                            if (cleanLower.includes(prevLower.slice(-20))) {
                                return clean;
                            }
                            
                            // Otherwise append
                            return prev + ' ' + clean;
                        });
                        setInterimText("");
                    } else {
                        setInterimText("");
                    }
                }
            } else if (type === 'error') {
                isProcessingRef.current = false;
                console.error('[Hook] Worker Error:', resultError);
                setError("Engine Error: " + resultError);
                setIsModelLoading(false); // Stop loading on error
            }
        };
        workerRef.current.postMessage({ type: 'init' });

        return () => {
            workerRef.current?.terminate();
        };
    }, [retryCount]);

    const stopListening = () => {
        sourceRef.current?.disconnect();
        processorRef.current?.disconnect();
        audioContextRef.current?.close();
        setIsListening(false);
        setAudioLevel(0);
    };

    const reloadModel = () => {
        console.log('[Hook] Reloading model...');
        stopListening(); // Force stop mic to prevent race conditions
        setIsModelLoading(true);
        setError(null);
        setRetryCount(c => c + 1);
    };

    const startListening = async () => {
        setError(null);
        try {
            // Use Electron's desktopCapturer to get system audio
            console.log('[Hook] Requesting audio sources from Electron...');

            if (!(window as any).electron || !(window as any).electron.getAudioSources) {
                console.error('[Hook] Electron API missing. Make sure preload script is loaded and app is restarted.');
                throw new Error('Electron API not initialized. Please restart the app.');
            }

            const sources = await (window as any).electron.getAudioSources();
            console.log('[Hook] Sources received:', sources);

            if (!sources || sources.length === 0) {
                throw new Error('No audio sources available');
            }

            // Log all sources for debugging
            console.log('[Hook] Available sources:');
            sources.forEach((s: any, idx: number) => {
                console.log(`  [${idx}] ${s.name} (${s.id}) - type: ${s.id.startsWith('screen') ? 'screen' : 'window'}`);
            });

            // Prefer screen sources (full screen capture usually includes system audio)
            // On Windows, we want the screen source that includes audio
            let screenSource = sources.find((s: any) => 
                s.id.startsWith('screen:') && s.name.toLowerCase().includes('entire screen')
            ) || sources.find((s: any) => s.id.startsWith('screen:')) || sources[0];
            
            console.log('[Hook] Selected source:', {
                name: screenSource.name,
                id: screenSource.id,
                index: sources.indexOf(screenSource)
            });

            // For system audio capture, we need both audio and video constraints
            // The audio comes bundled with the screen capture
            const constraints: any = {
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: screenSource.id
                    }
                } as any,
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: screenSource.id
                    } as any
                }
            };
            console.log('[Hook] Using constraints:', JSON.stringify(constraints, null, 2));

            // Get media stream using the source ID
            const stream = await navigator.mediaDevices.getUserMedia(constraints as any);
            console.log('[Hook] Stream acquired:', stream.id);

            // Stop video track immediately (we only need audio)
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.stop();
                stream.removeTrack(videoTrack);
            }

            // Verify we have audio
            const audioTracks = stream.getAudioTracks();
            const videoTracks = stream.getVideoTracks();
            
            console.log('[Hook] Stream tracks - Audio:', audioTracks.length, 'Video:', videoTracks.length);
            
            if (audioTracks.length === 0) {
                console.warn('[Hook] WARNING: No audio track found! System audio may not be available.');
                console.warn('[Hook] This might be a Windows limitation. Try selecting a different source or check system audio permissions.');
            } else {
                audioTracks.forEach((track, idx) => {
                    const settings = track.getSettings();
                    console.log(`[Hook] Audio Track ${idx}:`, {
                        enabled: track.enabled,
                        muted: track.muted,
                        readyState: track.readyState,
                        label: track.label,
                        settings: {
                            sampleRate: settings.sampleRate,
                            channelCount: settings.channelCount,
                            echoCancellation: settings.echoCancellation,
                            autoGainControl: settings.autoGainControl,
                            noiseSuppression: settings.noiseSuppression
                        }
                    });
                });
            }
            
            // If no audio tracks, we can't proceed
            if (audioTracks.length === 0) {
                throw new Error('No audio track found. System audio capture may not be supported on this system. Try a different audio source.');
            }

            const audioContext = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioContext;
            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;

            // Buffer size 4096 = ~0.256s at 16k
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            let buffer: Float32Array[] = [];
            let bufferLength = 0;
            // Vosk can process very small chunks for ultra-low latency
            const CHUNK_SIZE = 16000 * 0.3; // 0.3 second chunks for very low latency
            const OVERLAP_SIZE = 16000 * 0.1; // 0.1 second overlap
            let lastProcessTime = 0;
            const MIN_PROCESS_INTERVAL = 200; // Process every 200ms for ultra-low latency
            let samplesProcessed = 0;

            processor.onaudioprocess = (e) => {
                // GUARD: Do not process if model is loading (checked via Ref to avoid stale closure)
                if (isModelLoadingRef.current) return;

                const input = e.inputBuffer.getChannelData(0);

                // Calculate Volume Meter
                let sum = 0;
                for (let i = 0; i < input.length; i++) {
                    sum += input[i] * input[i];
                }
                const rms = Math.sqrt(sum / input.length);
                samplesProcessed++;

                // Normalized rough scale (0-100)
                const level = Math.min(100, Math.round(rms * 1000));
                setAudioLevel(level);

                // Always buffer audio
                const chunk = new Float32Array(input);
                buffer.push(chunk);
                bufferLength += chunk.length;

                // Process when we have enough audio and enough time has passed
                // Allow processing even if previous is still running (parallel processing for speed)
                const now = Date.now();
                const shouldProcess = bufferLength >= CHUNK_SIZE && 
                                    (now - lastProcessTime) >= MIN_PROCESS_INTERVAL;

                if (shouldProcess) {
                    // Calculate average RMS for this chunk
                    let chunkSum = 0;
                    for (const b of buffer) {
                        for (let i = 0; i < b.length; i++) {
                            chunkSum += b[i] * b[i];
                        }
                    }
                    const chunkRMS = Math.sqrt(chunkSum / bufferLength);
                    
                    // Only send if there's actual audio signal (lower threshold for faster response)
                    // Allow parallel processing - don't block on isProcessingRef
                    if (chunkRMS > 0.0005 && workerRef.current) {
                        isProcessingRef.current = true;
                        setInterimText("...");

                        // Create buffer for this chunk
                        const fullBuffer = new Float32Array(bufferLength);
                        let offset = 0;
                        for (const b of buffer) {
                            fullBuffer.set(b, offset);
                            offset += b.length;
                        }

                        // Reduced logging for performance
                        if (samplesProcessed % 10 === 0) {
                            console.log(`[Hook] Sending chunk: ${(bufferLength/16000).toFixed(2)}s`);
                        }

                        // Send to worker
                        workerRef.current.postMessage({ type: 'transcribe', audio: fullBuffer });
                        lastProcessTime = now;

                        // Keep overlap for next chunk (sliding window)
                        const overlapSamples = Math.floor(OVERLAP_SIZE);
                        if (bufferLength > overlapSamples) {
                            const overlapBuffer: Float32Array[] = [];
                            let overlapLength = 0;
                            let tempOffset = bufferLength - overlapSamples;
                            
                            for (const b of buffer) {
                                if (tempOffset <= 0) {
                                    overlapBuffer.push(b);
                                    overlapLength += b.length;
                                } else if (tempOffset < b.length) {
                                    const overlapChunk = b.slice(tempOffset);
                                    overlapBuffer.push(overlapChunk);
                                    overlapLength += overlapChunk.length;
                                }
                                tempOffset -= b.length;
                            }
                            
                            buffer = overlapBuffer;
                            bufferLength = overlapLength;
                        } else {
                            buffer = [];
                            bufferLength = 0;
                        }
                    } else if (chunkRMS <= 0.001) {
                        // Audio too quiet, reset buffer but keep some overlap
                        const keepSamples = Math.floor(OVERLAP_SIZE);
                        if (bufferLength > keepSamples) {
                            const keepBuffer: Float32Array[] = [];
                            let keepLength = 0;
                            let tempOffset = bufferLength - keepSamples;
                            
                            for (const b of buffer) {
                                if (tempOffset <= 0) {
                                    keepBuffer.push(b);
                                    keepLength += b.length;
                                } else if (tempOffset < b.length) {
                                    keepBuffer.push(b.slice(tempOffset));
                                    keepLength += b.length - tempOffset;
                                }
                                tempOffset -= b.length;
                            }
                            
                            buffer = keepBuffer;
                            bufferLength = keepLength;
                        }
                    }
                }
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            // Mute output to prevent feedback
            const gain = audioContext.createGain();
            gain.gain.value = 0;
            processor.connect(gain);
            gain.connect(audioContext.destination);

            setIsListening(true);
        } catch (e: any) {
            console.error(e);
            setError("Mic Error: " + e.message);
            setIsListening(false);
        }
    };

    return {
        text,
        interimText,
        isListening,
        startListening,
        stopListening,
        hasSupport: true,
        error,
        audioLevel,
        isModelLoading,
        reloadModel,
    };
}
