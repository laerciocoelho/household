/** Traduz erros do Supabase Auth para mensagens amigáveis em português. */
export function friendlyAuthError(error: { message?: string; code?: string; status?: number }): string {
  const code = error.code ?? '';
  const msg = (error.message ?? '').toLowerCase();

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'E-mail ou senha incorretos. Confira os dados e tente novamente.';
  }
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'Seu e-mail ainda não foi confirmado. Abra o link que enviamos para você e tente de novo.';
  }
  if (code === 'user_already_exists' || msg.includes('already registered')) {
    return 'Este e-mail já está cadastrado. Tente entrar com a sua senha.';
  }
  if (code === 'weak_password' || msg.includes('password should be')) {
    return 'A senha é muito fraca. Use pelo menos 6 caracteres.';
  }
  if (code === 'email_address_invalid' || code === 'validation_failed' || msg.includes('invalid email')
      || msg.includes('unable to validate email')) {
    return 'Informe um e-mail válido.';
  }
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error.status === 429
      || msg.includes('rate limit')) {
    return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
  }
  if (code === 'signup_disabled' || msg.includes('signups not allowed')) {
    return 'O cadastro de novas contas está desativado no momento.';
  }
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('fetch failed')) {
    return 'Não foi possível conectar. Verifique sua internet e tente novamente.';
  }
  return 'Não foi possível concluir a operação. Tente novamente em instantes.';
}
