import { useQuery } from '@tanstack/react-query';
import { authorApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';

export const useBooks = () => useQuery({ queryKey: qk.books, queryFn: authorApi.books });
