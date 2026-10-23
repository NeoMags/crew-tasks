import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Button, Screen, TextField } from '../../components/ui';
import { authErrorMessage, useAuth } from '../../lib/auth';
import { space, useTheme } from '../../theme';

export default function SignIn() {
  const c = useTheme();
  const { signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (!email.trim()) return setError('Enter your email first, then tap "Forgot password".');
    try {
      await resetPassword(email);
      Alert.alert('Check your email', 'We sent a link to reset your password.');
    } catch (e) {
      setError(authErrorMessage(e));
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ alignItems: 'center', marginTop: space.xl * 2, marginBottom: space.lg, gap: space.sm }}>
          <View style={{ backgroundColor: c.primarySoft, padding: 16, borderRadius: 24 }}>
            <Ionicons name="checkmark-done" size={40} color={c.primary} />
          </View>
          <Text style={{ color: c.text, fontSize: 28, fontWeight: '800' }}>Crew Tasks</Text>
          <Text style={{ color: c.muted, textAlign: 'center' }}>Assign work, track progress, get it done together.</Text>
        </View>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          onSubmitEditing={submit}
          error={error}
        />
        <Button title="Sign in" onPress={submit} loading={busy} />
        <Button title="Forgot password?" variant="ghost" onPress={forgot} />
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.md }}>
          <Text style={{ color: c.muted }}>New here?</Text>
          <Link href="/sign-up" style={{ color: c.primary, fontWeight: '600' }}>
            Create an account
          </Link>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
