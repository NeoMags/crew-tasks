import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Avatar, Button, EmptyState, ErrorBanner, Loading } from '../../../components/ui';
import { useMyGroups } from '../../../hooks/data';
import { useUser } from '../../../lib/auth';
import { radius, space, useTheme } from '../../../theme';

export default function Groups() {
  const c = useTheme();
  const user = useUser();
  const groups = useMyGroups(user.uid);

  if (groups.loading) return <Loading />;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      data={groups.data ?? []}
      keyExtractor={(g) => g.id}
      ListHeaderComponent={
        <View style={{ gap: space.sm, marginBottom: space.sm }}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button title="New group" icon="add" onPress={() => router.push('/group/new')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Join" icon="enter-outline" variant="secondary" onPress={() => router.push('/group/join')} />
            </View>
          </View>
          {groups.error ? <ErrorBanner message={groups.error} onRetry={groups.retry} /> : null}
        </View>
      }
      renderItem={({ item: g }) => {
        const names = g.memberIds.map((u) => g.members[u]?.name ?? '?');
        const role = g.members[user.uid]?.role;
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/group/${g.id}`)}
            style={({ pressed }) => ({
              backgroundColor: c.card,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: c.border,
              padding: space.lg,
              gap: 8,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: c.text, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>
                {g.name}
              </Text>
              {role !== 'member' ? (
                <Text style={{ color: c.primary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{role}</Text>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color={c.muted} />
            </View>
            {g.description ? (
              <Text style={{ color: c.muted }} numberOfLines={2}>
                {g.description}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {names.slice(0, 6).map((n, i) => (
                <View key={i} style={{ marginLeft: i ? -8 : 0 }}>
                  <Avatar name={n} size={28} />
                </View>
              ))}
              <Text style={{ color: c.muted, marginLeft: 8 }}>
                {names.length} member{names.length === 1 ? '' : 's'}
              </Text>
            </View>
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <EmptyState
          icon="people-outline"
          title="No groups yet"
          body="A group is a circle of friends who share tasks — a trip, a flat, an event, a side project."
        />
      }
    />
  );
}
