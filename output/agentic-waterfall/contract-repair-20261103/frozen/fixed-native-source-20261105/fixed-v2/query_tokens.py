"""Use the downloaded models' native tokenizer budget; record exact model inputs."""
import hashlib
import json

NATIVE_MAX_LENGTH = 8192
TOKEN_POLICY = 'native-8192-original-tokenizer-v1'


def native_length(tokenizer):
    if tokenizer.model_max_length != NATIVE_MAX_LENGTH:
        raise ValueError('downloaded tokenizer native length changed')
    if tokenizer.truncation_side != 'right' or tokenizer.padding_side != 'right':
        raise ValueError('downloaded tokenizer side differs from frozen native policy')
    return NATIVE_MAX_LENGTH


def token_hash(value):
    return hashlib.sha256(json.dumps(value, separators=(',', ':'), sort_keys=True).encode()).hexdigest()


def bounded_batches(lengths, max_sequences=8, max_padded_tokens=4096, max_attention_cells=2097152):
    """Change only padding/batch size; an over-budget native sequence runs alone."""
    start = 0
    while start < len(lengths):
        if type(lengths[start]) is not int or not 0 < lengths[start] <= NATIVE_MAX_LENGTH:
            raise ValueError('invalid encoded sequence length')
        end, longest = start + 1, lengths[start]
        while end < len(lengths) and end - start < max_sequences:
            candidate = lengths[end]
            if type(candidate) is not int or not 0 < candidate <= NATIVE_MAX_LENGTH:
                raise ValueError('invalid encoded sequence length')
            maximum = max(longest, candidate); count = end - start + 1
            if count * maximum > max_padded_tokens or count * maximum * maximum > max_attention_cells:
                break
            longest = maximum; end += 1
        yield start, end
        start = end


def history_spans(query, spec):
    if spec is None:
        return []
    parts, prefix, separator = spec['parts'], spec.get('prefix', ''), spec.get('separator', ' ')
    if not isinstance(parts, list) or any(not isinstance(x, str) for x in parts) or not isinstance(prefix, str) or not isinstance(separator, str):
        raise ValueError('invalid query history')
    if separator.join(([prefix] if prefix else []) + parts) != query:
        raise ValueError('history does not describe actual query')
    offset = len(prefix) + len(separator) if prefix and parts else 0
    spans = []
    for i, part in enumerate(parts):
        spans.append((i + 1, offset, offset + len(part)))
        offset += len(part) + len(separator)
    return spans


def encode_with_audit(tokenizer, queries, documents=None, histories=None):
    limit = native_length(tokenizer)
    kwargs = dict(padding=True, truncation=True, max_length=limit, return_tensors='pt', return_offsets_mapping=True)
    batch = tokenizer(queries, documents, **kwargs) if documents is not None else tokenizer(queries, **kwargs)
    offsets = batch.pop('offset_mapping').tolist()
    raw_cache = {}
    audit = []
    for i, query in enumerate(queries):
        if query not in raw_cache:
            raw_cache[query] = tokenizer(query, add_special_tokens=False, truncation=False, return_offsets_mapping=True, verbose=False)
        raw = raw_cache[query]
        owners = batch.sequence_ids(i)
        model_input = {key: value[i].tolist() for key, value in batch.items()}
        ids = model_input['input_ids']
        query_ids = [value for value, owner in zip(ids, owners) if owner == 0]
        doc_ids = [value for value, owner in zip(ids, owners) if owner == 1]
        used_offsets = [pair for pair, owner in zip(offsets[i], owners) if owner == 0]
        records = []
        for ordinal, start, end in history_spans(query, (histories or {}).get(i)):
            original = sum(a < end and b > start for a, b in raw['offset_mapping'])
            used = sum(a < end and b > start for a, b in used_offsets)
            records.append({'ordinal': ordinal, 'original_tokens': original, 'used_tokens': used,
                            'status': 'complete' if original == used else ('dropped' if used == 0 else 'partial')})
        doc_original = len(tokenizer.encode(documents[i], add_special_tokens=False, verbose=False)) if documents is not None else 0
        truncated = len(query_ids) < len(raw['input_ids']) or len(doc_ids) < doc_original
        audit.append({'input_index': i, 'policy': TOKEN_POLICY, 'max_length': limit,
                      'truncation': 'longest_first', 'truncation_side': tokenizer.truncation_side,
                      'original_tokens': len(raw['input_ids']), 'used_tokens': len(query_ids),
                      'token_budget': limit - tokenizer.num_special_tokens_to_add(pair=documents is not None) - len(doc_ids),
                      'document_original_tokens': doc_original, 'document_used_tokens': len(doc_ids),
                      'history_records': len(records), 'kept_history_records': sum(x['used_tokens'] > 0 for x in records),
                      'dropped_history_records': sum(x['status'] == 'dropped' for x in records),
                      'partial_history_records': sum(x['status'] == 'partial' for x in records),
                      'history_record_audit': records,
                      'truncation_reason': 'native_tokenizer_limit' if truncated else None,
                      'query_token_ids': query_ids, 'document_token_ids': doc_ids,
                      'token_sha256': token_hash(query_ids), 'model_input': model_input,
                      'model_input_sha256': token_hash(model_input)})
    return batch, audit


def embedding_inputs(tokenizer, texts, history_queries=None):
    return encode_with_audit(tokenizer, texts, histories=history_queries)


def reranker_inputs(tokenizer, query, documents, history=None):
    return encode_with_audit(tokenizer, [query] * len(documents), documents,
                             {i: history for i in range(len(documents))} if history is not None else None)
