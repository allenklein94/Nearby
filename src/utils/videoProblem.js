// The server's video refusals (supabase/functions/_shared/videoDuration.js VIDEO_CHECK_MESSAGES) in the person's language.
// The server answers in English, by code on a direct reply and as stored text on a library item or a background offer
// submission; both are read back to the same key here. Anything else is returned unchanged.
import { tr } from '../i18n/translate';

const BY_CODE = {
  video_too_long: 'videoTooLong',
  video_length_unchecked: 'videoLengthUnchecked',
  video_format_unsupported: 'videoFormatUnsupported',
};
// English source of each, exactly as the server stores it (a test keeps these equal to the server's messages).
export const SERVER_VIDEO_MESSAGES = {
  video_too_long: 'Videos can be up to 30 seconds. Trim it on your phone and try again.',
  video_length_unchecked: "We couldn't check this video's length.",
  video_format_unsupported: "This video format isn't supported. Use an MP4 or MOV video.",
};

export function videoProblemText(codeOrText) {
  if (typeof codeOrText !== 'string') return codeOrText;
  const code = BY_CODE[codeOrText] ? codeOrText : Object.keys(SERVER_VIDEO_MESSAGES).find((c) => SERVER_VIDEO_MESSAGES[c] === codeOrText);
  return code ? tr(`ui.bizHelp.offerForm.${BY_CODE[code]}`) : codeOrText;
}
