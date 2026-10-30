"""Balance two disjoint lanes while keeping each dependency chain together."""


def partition(tasks, completed=()):
    by_id={task['id']:task for task in tasks}
    if len(by_id)!=len(tasks) or any(task['dataset']=='mind' for task in tasks):
        raise ValueError('duplicate_task_or_excluded_dataset')
    position={task['id']:i for i,task in enumerate(tasks)}
    roots={}
    for task in tasks:
        current=task;seen=set()
        while current.get('previous'):
            if current['id'] in seen or current['previous'] not in by_id:
                raise ValueError('missing_or_cyclic_dependency')
            seen.add(current['id']);parent=by_id[current['previous']]
            if position[parent['id']]>=position[current['id']]:
                raise ValueError('dependency_must_precede_task')
            current=parent
        roots[task['id']]=current['id']
    groups={}
    for task in tasks:groups.setdefault(roots[task['id']],[]).append(task)
    lanes=[[],[]];pending=[0,0];completed=set(completed)
    for group in groups.values():
        lane=min(range(2),key=lambda index:(pending[index],len(lanes[index]),index))
        lanes[lane].extend(group);pending[lane]+=sum(task['id'] not in completed for task in group)
    return [sorted(lane,key=lambda task:position[task['id']]) for lane in lanes]
