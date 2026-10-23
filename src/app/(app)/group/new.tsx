import { router } from 'expo-router';
import React, { useState } from 'react';
import { Button, Muted, Screen, TextField } from '../../../components/ui';
import { useAction } from '../../../hooks/data';
import { useUser } from '../../../lib/auth';
import { createGroup } from '../../../lib/groups';
import { LIMITS } from '../../../lib/logic';

export default function NewGroup() {
  const user = useUser();
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  return (
    <Screen>
      <TextField
        label="Group name"
        value={name}
        onChangeText={setName}
        maxLength={LIMITS.groupName}
        placeholder="e.g. Goa trip, Flat 302, Wedding team"
        autoFocus
      />
      <TextField
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        maxLength={LIMITS.groupDescription}
        multiline
        placeholder="What is this group for?"
      />
      <Button
        title="Create group"
        disabled={!name.trim()}
        loading={!!busy}
        onPress={() =>
          run('create', async () => {
            const id = await createGroup(user, name, description);
            router.replace(`/group/${id}`);
          })
        }
      />
      <Muted>You'll get an invite code to share with friends.</Muted>
    </Screen>
  );
}
