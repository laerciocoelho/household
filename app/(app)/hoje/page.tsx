import { redirect } from 'next/navigation';

// "Hoje" agora é uma aba dentro de Planejamento.
export default function HojePage() {
  redirect('/planejador');
}
