// Ice breakers and "before you go" prep tips shown on the Gathering Hub.
// Static, per-category copy — not a per-gathering AI generation (this
// codebase has no LLM call anywhere in the gathering flow; see
// getHomeInsight in homeDashboard.js for the same no-new-API-cost
// tradeoff made for Home's "one sentence"). These are generic, honest
// advice/prompts, not a claim about this specific gathering, so they
// don't run into the "no invented numbers" convention the way a
// fabricated stat would.
//
// Localization pass 5: the arrays hold keys into ui.hubContent (English = the original wording), read in the current language.
import { tr } from '../i18n/translate';

const DEFAULT_ICE_BREAKERS = [
  'whatBroughtYouHereToday',
  'whatsKeptYouBusyLately',
  'anyRecommendationsAroundHere',
];

const ICE_BREAKERS = {
  Hiking: ['whatTrailDoYouRecommend', 'whatsTheBestHikeYouve', 'whatBroughtYouHere'],
  Outdoors: ['whatTrailDoYouRecommend', 'favoriteSpotToGetOutside', 'whatBroughtYouHere'],
  Coffee: ['whatsYourUsualOrder', 'whatsYourFavoriteLocalCoffee', 'whatBroughtYouHere'],
  Foodie: ['whatsYourFavoriteLocalRestaurant', 'whatsADishYouCould', 'whatBroughtYouHere'],
  Cooking: ['whatsYourGoToDish', 'anyRestaurantRecommendationsNearby', 'whatBroughtYouHere'],
  Wine: ['whatsYourFavoriteWineRegion', 'redOrWhite', 'whatBroughtYouHere'],
  Music: ['whatHaveYouBeenListening', 'anyConcertsYouHaveComing', 'whatBroughtYouHere'],
  Concerts: ['bestShowYouHaveEver', 'whoWouldYouLoveTo', 'whatBroughtYouHere'],
  Movies: ['whatsTheLastMovieYou', 'anyShowsYouAreCurrently', 'whatBroughtYouHere'],
  Reading: ['whatAreYouReadingRight', 'whatsABookYoudRecommend', 'whatBroughtYouHere'],
  Art: ['seenAnyGoodExhibitsLately', 'whatsAPieceOfArt', 'whatBroughtYouHere'],
  Museums: ['favoriteMuseumYouHaveVisited', 'whatKindOfExhibitsDo', 'whatBroughtYouHere'],
  Photography: ['whatDoYouLikeTo', 'phoneOrCamera', 'whatBroughtYouHere'],
  Gaming: ['whatHaveYouBeenPlaying', 'whatsAGameYouCould', 'whatBroughtYouHere'],
  Fitness: ['whatsYourFavoriteWayTo', 'morningOrEveningWorkouts', 'whatBroughtYouHere'],
  Yoga: ['howLongHaveYouBeen', 'favoriteStyleOfYoga', 'whatBroughtYouHere'],
  Running: ['whatsYourFavoriteRouteAround', 'trainingForAnything', 'whatBroughtYouHere'],
  Dancing: ['howDidYouGetInto', 'whatsYourFavoriteStyle', 'whatBroughtYouHere'],
  Sports: ['whatsYourTeam', 'doYouPlayOrJust', 'whatBroughtYouHere'],
  Travel: ['whatsTheBestPlaceYou', 'wheresNextOnYourList', 'whatBroughtYouHere'],
  Dogs: ['whatsYourDogsName', 'bestDogParkAroundHere', 'whatBroughtYouHere'],
  Cats: ['tellUsAboutYourCat', 'rescueOrBreeder', 'whatBroughtYouHere'],
  Volunteering: ['whatCausesDoYouCare', 'howDidYouFirstGet', 'whatBroughtYouHere'],
  Meditation: ['howLongHaveYouBeen', 'whatGotYouStarted', 'whatBroughtYouHere'],
  'Faith & Spirituality': ['whatDoesThisCommunityMean', 'howDidYouFirstGet2', 'whatBroughtYouHere'],
};

const DEFAULT_PREP_TIPS = ['bringWater', 'wearSomethingComfortable', 'chargeYourPhoneBeforeYou'];

const PREP_TIPS = {
  Hiking: ['comfortableShoes', 'bringWater', 'sunscreen'],
  Outdoors: ['comfortableShoes', 'bringWater', 'sunscreen'],
  Fitness: ['workoutClothes', 'bringWater', 'aTowel'],
  Running: ['runningShoes', 'bringWater', 'checkTheWeatherBeforeYou'],
  Yoga: ['aMatIfYouHave', 'comfortableStretchyClothes', 'bringWater'],
  Dancing: ['comfortableShoesYouCanMove', 'comeWithAnOpenMind'],
  Cooking: ['comeHungry', 'anApronIfYouHave'],
  Wine: ['eatSomethingBeforehand', 'bringAValidId'],
  Sports: ['comfortableShoes', 'bringWater'],
  Volunteering: ['comfortableClothesYouDontMind', 'bringWater'],
};

export function iceBreakersFor(interestTag) {
  return (ICE_BREAKERS[interestTag] ?? DEFAULT_ICE_BREAKERS).map((key) => tr(`ui.hubContent.${key}`));
}

export function prepTipsFor(interestTag) {
  return (PREP_TIPS[interestTag] ?? DEFAULT_PREP_TIPS).map((key) => tr(`ui.hubContent.${key}`));
}
