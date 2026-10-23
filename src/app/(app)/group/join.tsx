import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Button, Muted, Screen, TextField } from '../../../components/ui';
import { useAction } from '../../../hooks/data';
import { useUser } from '../../../lib/auth';
import { joinGroupByCode } from '../../../lib/groups';

export default function JoinGroup() {
  const user = useUser();
  const params = useLocalSearchParams<{ code?: string }>();
  const { busy, run } = useAction();
  const [code, setCode] = useState((params.code ?? '').toUpperCase());

  return (
    <Screen>
      <TextField
        label="Invite code"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        placeholder="ABC234"
        autoFocus={!params.code}
        style={{ fontSize: 24, letterSpacing: 6, textAlign: 'center', fontWeight: '700' }}
      />
      <Button
        title="Join group"
        disabled={code.trim().length < 6}
        loading={!!busy}
        onPress={() =>
          run('join', async () => {
            const id = await joinGroupByCode(user, code);
            router.replace(`/group/${id}`);
          })
        }
      />
      <Muted>Ask a group admin for the code. Codes expire after 7 days.</Muted>
    </Screen>
  );
}
