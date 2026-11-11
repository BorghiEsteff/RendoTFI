import { redirect } from 'next/navigation';

export default function DevRoot({ params: { locale } }: { params: { locale: string } }) {
  redirect('/' + locale + '/dev/metricas');
}
