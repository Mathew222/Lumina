export const BROADCAST_CHANNEL_NAME = 'live_subtitle_channel';

export const sendMessage = (channel: BroadcastChannel, type: string, payload: any) => {
    channel.postMessage({ type, payload });
};
