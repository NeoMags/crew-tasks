import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { Button, Muted, Screen, TextField } from '../../components/ui';
import { authErrorMessage, useAuth } from '../../lib/auth';
import { LIMITS } from '../../lib/logic';

export default function SignUp() {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return setError('Enter your name so friends know who you are.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    setBusy(true);
    setError(null);
    try {
      await signUp(name, email, password);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <TextField
          label="Your name"
          value={name}
          onChangeText={setName}
          maxLength={LIMITS.displayName}
          autoComplete="name"
          hint="Shown to friends in your groups and used for @mentions."
        />
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          error={error}
          hint="At least 6 characters."
        />
        <Button title="Create account" onPress={submit} loading={busy} />
        <Muted style={{ textAlign: 'center' }}>Your tasks are visible only to members of groups you join.</Muted>
      </Screen>
    </KeyboardAvoidingView>
  );
}
