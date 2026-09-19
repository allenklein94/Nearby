import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import LoginScreen from '../screens/LoginScreen';
import BusinessWebHomeScreen from '../screens/BusinessWebHomeScreen';
import BusinessDashboardScreen from '../screens/BusinessDashboardScreen';
import BusinessProfileScreen from '../screens/BusinessProfileScreen';
import BusinessConversationScreen from '../screens/BusinessConversationScreen';
import BusinessAIAssistantScreen from '../screens/BusinessAIAssistantScreen';
import BusinessAIAutomationScreen from '../screens/BusinessAIAutomationScreen';
import CreateGatheringScreen from '../screens/CreateGatheringScreen';
import EditGatheringScreen from '../screens/EditGatheringScreen';
import GatheringDetailScreen from '../screens/GatheringDetailScreen';
import GatheringConfirmationScreen from '../screens/GatheringConfirmationScreen';
import GatheringChatScreen from '../screens/GatheringChatScreen';
import SelectGatheringLocationScreen from '../screens/SelectGatheringLocationScreen';
import CreateCommunityScreen from '../screens/CreateCommunityScreen';
import EditCommunityScreen from '../screens/EditCommunityScreen';
import CommunityDetailScreen from '../screens/CommunityDetailScreen';
import CommunityChatScreen from '../screens/CommunityChatScreen';
import ViewProfileScreen from '../screens/ViewProfileScreen';

const Stack = createNativeStackNavigator();

// Phase 7 (Business Web, CLAUDE.md) -- a deliberately small, separate
// NavigationContainer/stack from RootNavigator.js's ~90-screen consumer
// tree: only the 6 screens an approved business owner's own management
// surface actually needs, every one imported unmodified from src/screens/
// (zero duplicated business logic). No `linking` prop on purpose -- this
// is a different NavigationContainer than the native app's, doesn't need
// to extend its nearby:// deep-link config, and keeping screens purely
// in-memory (browser URL never changes per screen) sidesteps the classic
// GitHub-Pages-SPA-refresh-404 problem for a v1 without a 404.html
// redirect trick.
//
// A business owner reaching this navigator will already have
// profileComplete=true and managed_partner_id set -- the only way that
// gets linked is via approve_business_partner_request()'s phone-matched
// claim trigger, which requires having already completed real phone-OTP
// signup + CompleteProfileScreen once in the native app -- so there's no
// onboarding flow to duplicate here; BusinessWebHomeScreen's own
// managed_partner_id check is the entire gate.
export default function BusinessWebNavigator() {
  const { session, loading, profileLoading } = useAuth();
  const { colors } = useTheme();

  if (loading || (session && profileLoading)) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="BusinessWebHome" component={BusinessWebHomeScreen} />
            <Stack.Screen name="BusinessDashboard" component={BusinessDashboardScreen} options={{ headerShown: true, title: 'Business Dashboard', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="BusinessProfile" component={BusinessProfileScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="BusinessConversation" component={BusinessConversationScreen} options={{ headerShown: true, title: 'Message', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="BusinessAIAssistant" component={BusinessAIAssistantScreen} options={{ headerShown: true, title: 'AI Assistant', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="BusinessAIAutomation" component={BusinessAIAutomationScreen} options={{ headerShown: true, title: 'AI Automation', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />

            {/* Hosting: the same gathering/community screens the app uses (no duplicated logic). */}
            <Stack.Screen name="CreateGathering" component={CreateGatheringScreen} options={{ headerShown: true, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, title: 'Host a Gathering' }} />
            <Stack.Screen name="EditGathering" component={EditGatheringScreen} options={{ headerShown: true, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, title: 'Edit Gathering' }} />
            <Stack.Screen name="SelectGatheringLocation" component={SelectGatheringLocationScreen} options={{ headerShown: true, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, title: 'Set Location' }} />
            <Stack.Screen name="GatheringConfirmation" component={GatheringConfirmationScreen} options={{ headerShown: false }} />
            <Stack.Screen name="GatheringDetail" component={GatheringDetailScreen} options={{ headerShown: true, title: '', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="GatheringChat" component={GatheringChatScreen} options={({ route }) => ({ headerShown: true, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, title: route.params?.gatheringTitle ? `${route.params.gatheringTitle} Chat` : 'Gathering Chat' })} />
            <Stack.Screen name="CreateCommunity" component={CreateCommunityScreen} options={{ headerShown: true, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, title: 'Create Community' }} />
            <Stack.Screen name="EditCommunity" component={EditCommunityScreen} options={{ headerShown: true, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, title: 'Edit Community' }} />
            <Stack.Screen name="CommunityDetail" component={CommunityDetailScreen} options={{ headerShown: true, title: '', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="CommunityChat" component={CommunityChatScreen} options={({ route }) => ({ headerShown: true, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, title: route.params?.communityName ? `${route.params.communityName} Chat` : 'Community Chat' })} />
            <Stack.Screen name="ViewProfile" component={ViewProfileScreen} options={{ headerShown: true, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, title: 'Profile' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
