import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Button, Muted, Screen, TextField } from '../../components/ui';
import { authClient } from '../../lib/api';
import { authErrorMessage } from '../../lib/auth';

/** Two steps: email → 6-digit code + new password. */
export default function ResetPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    if (!email.trim()) return setError('Enter the email you signed up with.');
    setBusy(true);
    setError(null);
    try {
      const r = await authClient.emailOtp.requestPasswordReset({ email: email.trim() });
      if (r.error) throw Object.assign(new Error(r.error.message ?? 'Could not send the code.'), { code: r.error.code });
      setStep('code');
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!/^\d{6}$/.test(otp.trim())) return setError('Enter the 6-digit code from the email.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    setBusy(true);
    setError(null);
    try {
      const r = await authClient.emailOtp.resetPassword({ email: email.trim(), otp: otp.trim(), password });
      if (r.error) throw Object.assign(new Error(r.error.message ?? 'That code is wrong or has expired.'), { code: r.error.code });
      Alert.alert('Password changed', 'Sign in with your new password.');
      router.back();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        {step === 'email' ? (
          <>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              error={error}
            />
            <Button title="Email me a code" onPress={sendCode} loading={busy} />
            <Muted>We’ll send a 6-digit code. It expires in 10 minutes.</Muted>
          </>
        ) : (
          <>
            <Muted>If an account exists for {email.trim()}, a code is on its way. Check spam too.</Muted>
            <TextField
              label="6-digit code"
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
            />
            <TextField
              label="New password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              error={error}
            />
            <Button title="Set new password" onPress={reset} loading={busy} />
            <Button title="Send a new code" variant="ghost" onPress={sendCode} disabled={busy} />
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
