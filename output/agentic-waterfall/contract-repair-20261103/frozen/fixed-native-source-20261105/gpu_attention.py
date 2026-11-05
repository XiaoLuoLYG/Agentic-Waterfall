"""Bound MPS attention workspace; each query still attends to every key."""
import torch

_sdpa = torch.nn.functional.scaled_dot_product_attention
STATS = {'chunked_layer_calls': 0, 'max_query_tokens': 0, 'max_driver_bytes': 0}


def chunked_attention(query, key, value, attn_mask=None, dropout_p=0.0,
                      is_causal=False, scale=None, chunk_size=1024):
    # This execution path is only for the frozen bidirectional inference models.
    if dropout_p or is_causal:
        raise ValueError('chunking requires noncausal attention without dropout')
    pieces = []
    for start in range(0, query.shape[-2], chunk_size):
        end = start + chunk_size
        mask = attn_mask
        if mask is not None and mask.ndim >= 2 and mask.shape[-2] != 1:
            mask = mask[..., start:end, :]
        part = query[..., start:end, :]
        if mask is not None:
            mask = mask.expand(*part.shape[:-1], key.shape[-2]).contiguous()
        pieces.append(_sdpa(part, key, value,
                            attn_mask=mask, dropout_p=0.0, is_causal=False, scale=scale))
    return torch.cat(pieces, dim=-2)


def gpu_attention(query, key, value, attn_mask=None, dropout_p=0.0,
                  is_causal=False, scale=None):
    if any(t.device.type != 'mps' for t in (query, key, value)):
        raise ValueError('GPU-only model inference required')
    if query.shape[-2] <= 4096:
        return _sdpa(query, key, value, attn_mask=attn_mask, dropout_p=dropout_p,
                     is_causal=is_causal, scale=scale)
    result = chunked_attention(query, key, value, attn_mask, dropout_p, is_causal, scale)
    STATS['chunked_layer_calls'] += 1
    STATS['max_query_tokens'] = max(STATS['max_query_tokens'], query.shape[-2])
    STATS['max_driver_bytes'] = max(STATS['max_driver_bytes'], torch.mps.driver_allocated_memory())
    return result
