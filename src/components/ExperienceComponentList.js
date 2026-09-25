import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { priceChipLabel } from '../utils/experienceBudget';
import { picksLengthLine } from '../utils/planTiming';
import ExperiencePerkLine from './ExperiencePerkLine';
import { createExperiencePlan, experienceStopFromItem } from '../services/plans';

// The Experience's components with real supply, plus the way to turn the person's picks into ONE Plan: at most one pick
// per component, "Plan this night" appears only once two or more parts are picked (one part is just a single thing to
// do). Presentation of each item stays with the host screen (`renderItem`); this only adds the pick toggle, the perk
// add-on line and the plan bar. Nothing is booked here and no date is invented -- the Plan holds the chosen stops and
// each continues through its existing flow.
export default function ExperienceComponentList({ experience, renderItem, navigation, partySize = null, labelStyle, componentStyle }) {
  const { colors } = useTheme();
  const [picked, setPicked] = useState({}); // componentKey -> stop
  const [creating, setCreating] = useState(false);
  const stops = experience.components.map((c) => picked[c.key]).filter(Boolean);
  // The items behind the picks, for their usual total next to "Plan this night" (utils/planTiming.js).
  const pickedItems = experience.components
    .map((c) => c.items.find((item) => picked[c.key] && experienceStopFromItem(c, item)?.refId === picked[c.key].refId))
    .filter(Boolean);
  const picksLine = picksLengthLine(pickedItems, experience.timing?.budget ?? null);
  const timingLines = [experience.timing?.line].filter(Boolean);

  function toggle(component, item) {
    const stop = experienceStopFromItem(component, item);
    if (!stop) return;
    setPicked((prev) => {
      const next = { ...prev };
      if (prev[component.key]?.refId === stop.refId) delete next[component.key];
      else next[component.key] = stop;
      return next;
    });
  }

  async function planIt() {
    if (creating || stops.length < 2) return;
    setCreating(true);
    try {
      const planId = await createExperiencePlan({
        title: (experience.title || 'Your night').replace(/^✨\s*/, ''),
        stops,
        partySize,
      });
      navigation.navigate('PlanDetail', { planId });
    } catch (e) {
      Alert.alert("Couldn't plan this night", "One of those options may no longer be available. Pull to refresh and try again.");
    }
    setCreating(false);
  }

  return (
    <>
      {timingLines.map((line) => (
        <Text key={line} style={{ ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs }}>⏱️ {line}</Text>
      ))}
      {experience.components.map((component) => (
        <View key={component.key} style={componentStyle ?? { marginBottom: spacing.sm }}>
          <Text style={labelStyle}>{component.label}</Text>
          {component.items.map((item, index) => {
            const stop = experienceStopFromItem(component, item);
            const isPicked = !!stop && picked[component.key]?.refId === stop.refId;
            return (
              <React.Fragment key={`${item.type}-${item.id}`}>
                {renderItem(item, index)}
                {priceChipLabel(item) ? (
                  <Text style={{ ...typography.caption, color: colors.textSecondary, marginLeft: spacing.lg, marginBottom: 2 }}>{priceChipLabel(item)}</Text>
                ) : null}
                <ExperiencePerkLine item={item} />
                {stop ? (
                  <TouchableOpacity
                    onPress={() => toggle(component, item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isPicked }}
                    accessibilityLabel={isPicked ? `Remove from your night: ${item.title}` : `Add to your night: ${item.title}`}
                    style={{
                      alignSelf: 'flex-start', marginLeft: spacing.lg, marginBottom: spacing.sm, paddingVertical: 4, paddingHorizontal: spacing.md,
                      borderRadius: radius.lg, borderWidth: 1, borderColor: isPicked ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ ...typography.caption, color: isPicked ? colors.primary : colors.textSecondary, fontWeight: '600' }}>
                      {isPicked ? '✓ In your night' : '+ Add to your night'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </React.Fragment>
            );
          })}
        </View>
      ))}
      {stops.length >= 2 && picksLine ? (
        <Text style={{ ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs }}>⏱️ {picksLine}</Text>
      ) : null}
      {stops.length >= 2 && (
        <TouchableOpacity
          onPress={planIt}
          disabled={creating}
          accessibilityRole="button"
          accessibilityLabel={`Plan this night with ${stops.length} stops`}
          style={{ backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md }}
        >
          {creating
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Plan this night · {stops.length} stops →</Text>}
        </TouchableOpacity>
      )}
    </>
  );
}
