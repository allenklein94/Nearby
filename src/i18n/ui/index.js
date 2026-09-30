// Ordinary screen text, one module per screen/component namespace (localization pass 5, 2026-09-29). Each module exports
// { en: {...}, es: {...}, ... } for all 11 languages; read through the ONE lookup as t('ui.<namespace>.<key>', vars) (or tr()
// outside a component). English is the app's own wording; the other ten are machine-authored and need native-speaker review.
// Display text only: never a stored value, a canonical key, a name or anything a person typed.
import common from './common';
import matchNotes from './matchNotes';
import musicMode from './musicMode';
import sharedPlaylist from './sharedPlaylist';
import tripPlanning from './tripPlanning';
import sharedDecisions from './sharedDecisions';
import relationship from './relationship';
import places from './places';
import makeAPlan from './makeAPlan';
import goodbyeArchive from './goodbyeArchive';
import startSomething from './startSomething';
import media from './media';
import selectLocation from './selectLocation';
import emergencyContacts from './emergencyContacts';
import reportBlock from './reportBlock';
import compatibility from './compatibility';
import paywallUi from './paywallUi';
import dateCheckIn from './dateCheckIn';
import relationshipLegacy from './relationshipLegacy';
import brandOffersUi from './brandOffersUi';
import chemistryDiary from './chemistryDiary';
import momentum from './momentum';
import billing from './billing';
import createHub from './createHub';
import datingPrefs from './datingPrefs';
import features from './features';
import dateProposal from './dateProposal';
import dating from './dating';
import occasions from './occasions';
import gatheringParts from './gatheringParts';
import hubContent from './hubContent';
import gatheringHub from './gatheringHub';
import gatheringConfirmation from './gatheringConfirmation';
import crossedPaths from './crossedPaths';
import friends from './friends';
import planCompletion from './planCompletion';
import matches from './matches';
import viewProfile from './viewProfile';
import community from './community';
import nav from './nav';
import onboarding from './onboarding';
import groupChat from './groupChat';
import chat from './chat';
import celebrate from './celebrate';
import groupOccasionPlan from './groupOccasionPlan';
import planDetail from './planDetail';
import groupPlan from './groupPlan';
import requestDetail from './requestDetail';
import askBusiness from './askBusiness';
import optionVocab from './optionVocab';
import settings from './settings';
import profile from './profile';
import basicsVocab from './basicsVocab';
import offerCopy from './offerCopy';
import activity from './activity';
import gatheringForm from './gatheringForm';
import gatheringOptions from './gatheringOptions';
import gatheringDetail from './gatheringDetail';
import gatheringVocab from './gatheringVocab';
import gatherings from './gatherings';
import discover from './discover';
import empty from './empty';
import shared from './shared';
import plans from './plans';
import actions from './actions';
import home from './home';
import homeParts from './homeParts';

export const UI_NAMESPACES = { common, plans, shared, empty, actions, home, homeParts, discover, gatherings, gatheringVocab, gatheringDetail, gatheringOptions, gatheringForm, activity, offerCopy, basicsVocab, profile, settings, optionVocab, askBusiness, requestDetail, groupPlan, planDetail, groupOccasionPlan, celebrate, chat, groupChat, onboarding, nav, community, viewProfile, matches, planCompletion, friends, crossedPaths, gatheringConfirmation, gatheringHub, hubContent, gatheringParts, occasions, dating, dateProposal, features, datingPrefs, createHub, billing, momentum, chemistryDiary, brandOffersUi, relationshipLegacy, dateCheckIn, paywallUi, compatibility, reportBlock, emergencyContacts, selectLocation, media, startSomething, goodbyeArchive, makeAPlan, places, relationship, sharedDecisions, tripPlanning, sharedPlaylist, musicMode, matchNotes };

export const UI_LANGUAGES = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];

export const UI_STRINGS = Object.fromEntries(UI_LANGUAGES.map((lang) => [
  lang,
  Object.fromEntries(Object.entries(UI_NAMESPACES).map(([ns, mod]) => [ns, mod[lang] ?? {}])),
]));
