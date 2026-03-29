/**
 * YouTube — HTML parser
 * Extracts video data from ytInitialData JSON embedded in YouTube search pages.
 */

export function parsePage(html, url) {
  const match = html.match(/var ytInitialData = ({.*?});<\/script>/s);
  if (!match) return [];

  let data;
  try { data = JSON.parse(match[1]); } catch { return []; }

  const videos = [];
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.videoRenderer) {
      const vr = obj.videoRenderer;
      const title = vr.title?.runs?.[0]?.text || '';
      const videoId = vr.videoId || '';
      const channel = vr.ownerText?.runs?.[0]?.text || '';
      const channelUrl = vr.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
      const views = vr.viewCountText?.simpleText || vr.viewCountText?.runs?.[0]?.text || '';
      const shortViews = vr.shortViewCountText?.simpleText || '';
      const duration = vr.lengthText?.simpleText || '';
      const published = vr.publishedTimeText?.simpleText || '';
      const thumbnail = vr.thumbnail?.thumbnails?.at(-1)?.url || '';
      const richThumb = vr.richThumbnail?.movingThumbnailRenderer?.movingThumbnailDetails?.thumbnails?.[0]?.url || '';
      const description = vr.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map(r => r.text).join('') || '';
      const channelThumb = vr.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail?.thumbnails?.[0]?.url || '';
      const badges = (vr.badges || []).map(b => b.metadataBadgeRenderer?.label).filter(Boolean);

      const viewNum = parseInt((views.match(/[\d.,]+/) || ['0'])[0].replace(/[.,]/g, '')) || 0;
      const durParts = duration.split(':').map(Number).reverse();
      const durationSec = (durParts[0] || 0) + (durParts[1] || 0) * 60 + (durParts[2] || 0) * 3600;

      if (title && videoId) {
        videos.push({
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          channel,
          channelUrl: channelUrl ? `https://www.youtube.com${channelUrl}` : '',
          channelAvatar: channelThumb,
          views,
          shortViews,
          _views_num: viewNum,
          duration,
          _duration_sec: durationSec,
          published,
          thumbnail,
          richThumbnail: richThumb,
          description: description.substring(0, 500),
          badges: badges.join(', '),
          source: 'youtube',
        });
      }
    }
    if (Array.isArray(obj)) obj.forEach(walk);
    else Object.values(obj).forEach(walk);
  }

  walk(data);
  return videos;
}
