export interface ScanSummary {
  mode: string;
  itemCount: number;
  totalSizeBytes: number;
  sampleFiles: string[];
}

export async function getEcoTip(summary: ScanSummary): Promise<string> {
  return getFallbackTip(summary.mode);
}

function getFallbackTip(mode: string): string {
  const tips: Record<string, string> = {
    junk: 'Cache and temp files silently pile up, forcing your phone to work harder and use more energy. Clearing them regularly can save battery life \u2014 and every bit of saved energy means less load on power grids. Fun fact: the world\u2019s data centers use about 1\u20132% of global electricity!',
    large: 'Large forgotten files keep your storage chips powered and active for no reason. Deleting unused big files can improve your device\u2019s efficiency and longevity. Did you know? Storing 1 GB of data in the cloud for a year produces roughly 2 kg of CO\u2082.',
    duplicates: 'Duplicate files double the storage burden without any benefit \u2014 that\u2019s wasted energy keeping copies alive on disk and in cloud backups. Removing them is one of the easiest wins for a greener digital footprint!',
    trash: 'Files in your trash still take up space and consume energy. Emptying the trash is like turning off a light in an empty room \u2014 small action, real impact. Every MB freed helps your device run more efficiently.',
    empty: 'Empty folders may seem harmless, but thousands of them slow down file indexing, making your device work harder during searches. A tidier file system means faster scans and less wasted processing energy.',
    compress: 'Compressing large files can cut their size by 30\u201370%, meaning less storage energy and faster transfers that save bandwidth. It\u2019s like carpooling for your data \u2014 same content, smaller footprint!',
    whatsapp: 'WhatsApp media piles up fast \u2014 every forwarded video and meme takes up storage and energy. Cleaning sent media alone can free up gigabytes! Did you know a single viral video shared across millions of phones uses as much energy as a small town?',
    facebook: 'Facebook caches images, videos, and browsing data constantly. Clearing this cache regularly can free hundreds of MB and keep your phone running snappy. Less cached data means less battery drain from background syncing!',
    instagram: 'Instagram stores cached reels, stories, and thumbnails that pile up over weeks. Clearing this data can recover significant space. Fun fact: streaming just 1 hour of video uses about 300 MB \u2014 imagine how much your cached Reels add up to!',
  };
  return tips[mode] || 'Every byte you clean from your device saves a tiny bit of energy. Small digital habits add up to real environmental impact \u2014 keep your storage tidy and your carbon footprint lighter!';
}
