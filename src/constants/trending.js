// "Trending" is a claim about real attendance. A gathering is only trending when at least this many approved attendees
// are going -- half of the fit-score formula's own attendance cap, so it is grounded in an existing number. Shared by
// Discover and Home so both surfaces mean the same thing by the word (global rule 7: the UI agrees with the data).
export const TRENDING_ATTENDANCE_MIN = 5;
