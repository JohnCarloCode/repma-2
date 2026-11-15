import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { createReplenishmentListBody, type CreateReplenishmentListBody, type ReplenishmentList } from 'shared';
import { api, ApiError } from '../../lib/apiClient';
import { useToast } from '../../lib/toast';
import { useStoreScope } from '../../tenant/activeStore';
import { textAreaClass, textInputClass } from '../form';
import { FormModal } from '../Modal';

type Field = 'name' | 'notes';
type Values = Record<Field, string>;
type FieldErrors = Partial<Record<Field, string>>;

const EMPTY: Values = { name: '', notes: '' };

/** The shared body schema's messages, first one per field (components.md §Forms). */
function validate(values: Values) {
  const result = createReplenishmentListBody.safeParse(values);
  const errors: FieldErrors = {};
  for (const issue of result.error?.issues ?? []) {
    const field = issue.path[0] as Field;
    errors[field] ??= issue.message;
  }
  return { body: result.data, errors };
}

/**
 * replenishment.md §Flows · Create manually (RF-27): the "New list" form modal — Name
 * (required) and Notes (optional), nothing else (DP-06: a list is never pre-filled). It owns
 * its mutation: 201 → toast, lists invalidated, navigate to the new list's detail so items can
 * be added right away; 400 → inline field errors, modal stays open; anything else → error toast.
 * Mounted wherever "New list" is offered (the index, Home); render it behind `replenishment:manage`.
 */
export function NewListModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const scope = useStoreScope();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  // Validate on submit, then per field on blur (components.md §Forms).
  const [submitted, setSubmitted] = useState(false);

  const reset = () => {
    setValues(EMPTY);
    setErrors({});
    setSubmitted(false);
  };

  const create = useMutation({
    mutationFn: (body: CreateReplenishmentListBody) =>
      api.post<ReplenishmentList>('/replenishment-lists', body, scope.request),
    onSuccess: (list) => {
      toast.success('List created');
      void queryClient.invalidateQueries({ queryKey: scope.key('replenishment') });
      onClose();
      reset();
      navigate(`/replenishment/${list.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400 && Array.isArray(error.details)) {
        const fieldErrors: FieldErrors = {};
        for (const { path, message } of error.details as { path: string; message: string }[]) {
          if (path === 'name' || path === 'notes') fieldErrors[path] ??= message;
        }
        if (Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors);
          return;
        }
      }
      toast.error(error);
    },
  });

  const close = () => {
    onClose();
    reset();
  };

  const submit = () => {
    setSubmitted(true);
    const { body, errors: found } = validate(values);
    setErrors(found);
    if (body) create.mutate(body);
  };

  const field = (name: Field) => ({
    id: `new-list-${name}`,
    name,
    value: values[name],
    onChange: (e: { target: { value: string } }) => setValues((current) => ({ ...current, [name]: e.target.value })),
    onBlur: () => {
      if (submitted) setErrors((current) => ({ ...current, [name]: validate(values).errors[name] }));
    },
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `new-list-${name}-error` : undefined,
  });

  const error = (name: Field) =>
    errors[name] && (
      <span id={`new-list-${name}-error`} className="text-caption text-alert">
        {errors[name]}
      </span>
    );

  return (
    <FormModal
      open={open}
      onClose={close}
      title="New list"
      submitLabel="Create list"
      pendingLabel="Creating…"
      pending={create.isPending}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-xs">
        <label htmlFor="new-list-name" className="text-label text-text">
          Name
        </label>
        <input {...field('name')} type="text" maxLength={120} autoComplete="off" className={textInputClass} />
        {error('name')}
      </div>
      <div className="flex flex-col gap-xs">
        <label htmlFor="new-list-notes" className="text-label text-text">
          Notes <span className="text-text-secondary">(optional)</span>
        </label>
        <textarea {...field('notes')} maxLength={2000} className={textAreaClass} />
        {error('notes')}
      </div>
    </FormModal>
  );
}
