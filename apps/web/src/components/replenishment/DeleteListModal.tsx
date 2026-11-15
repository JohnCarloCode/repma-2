import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '../../lib/toast';
import { api } from '../../lib/apiClient';
import { useStoreScope } from '../../tenant/activeStore';
import { ConfirmModal } from '../Modal';

interface DeleteListModalProps {
  /** The list to delete; `null` = closed. */
  list: { id: string; name: string } | null;
  onClose: () => void;
  /** After the 204, once the modal has closed (e.g. the detail navigates back to the index). */
  onDeleted?: () => void;
}

/**
 * replenishment.md §Flows · Delete (RF-29): the confirm naming the list, with the cascade
 * consequence (RN-09). It owns its mutation: 204 → close, toast, lists invalidated (an emptied
 * page then recovers via `useEmptyPageRecovery`); any error (e.g. 404 already deleted) → close,
 * error toast, and the store's replenishment queries refetched so stale cards/details settle.
 */
export function DeleteListModal({ list, onClose, onDeleted }: DeleteListModalProps) {
  const scope = useStoreScope();
  const queryClient = useQueryClient();
  const toast = useToast();
  // Keeps the name on screen while the dialog fades out after `list` turns null.
  const [shown, setShown] = useState(list);
  if (list && list !== shown) setShown(list);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/replenishment-lists/${id}`, scope.request),
    onSuccess: () => {
      onClose();
      toast.success('List deleted');
      void queryClient.invalidateQueries({ queryKey: scope.key('replenishment', 'lists') });
      void queryClient.invalidateQueries({ queryKey: scope.key('home') });
      onDeleted?.();
    },
    onError: (error) => {
      onClose();
      toast.error(error);
      void queryClient.invalidateQueries({ queryKey: scope.key('replenishment') });
      void queryClient.invalidateQueries({ queryKey: scope.key('home') });
    },
  });

  return (
    <ConfirmModal
      open={list !== null}
      onClose={onClose}
      title="Delete list"
      message={`Delete the list “${shown?.name ?? ''}”? Its items will be deleted too.`}
      confirmLabel="Delete list"
      pendingLabel="Deleting…"
      pending={remove.isPending}
      onConfirm={() => list && remove.mutate(list.id)}
    />
  );
}
