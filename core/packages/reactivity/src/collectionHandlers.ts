import { toRaw, ReactiveFlags, toReactive, toReadonly } from './reactive'
import { track, trigger, ITERATE_KEY, MAP_KEY_ITERATE_KEY } from './effect'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { capitalize, hasOwn, hasChanged, toRawType, isMap } from '@vue/shared'

export type CollectionTypes = IterableCollections | WeakCollections

type IterableCollections = Map<any, any> | Set<any>
type WeakCollections = WeakMap<any, any> | WeakSet<any>
type MapTypes = Map<any, any> | WeakMap<any, any>
type SetTypes = Set<any> | WeakSet<any>
// From get:
// Return To get: 啥也没做，返回value值
const toShallow = <T extends unknown>(value: T): T => value
// From get:
// Return To get: 返回对象原型
const getProto = <T extends CollectionTypes>(v: T): any =>
  Reflect.getPrototypeOf(v)
// From mutableInstrumentations:
function get(
  target: MapTypes,
  key: unknown,
  isReadonly = false,
  isShallow = false
) {
  // #1772: readonly(reactive(Map)) should return readonly + reactive version
  // of the value
  target = (target as any)[ReactiveFlags.RAW]
  // 获取原始target
  const rawTarget = toRaw(target)
  // 获取原始key
  const rawKey = toRaw(key)
  // 如果key不等于原始key
  if (key !== rawKey) {
    // 如果不是只读，以GET类型执行track,以key为关联
    !isReadonly && track(rawTarget, TrackOpTypes.GET, key)
  }
  // 以GET类型执行track,以key为关联，以rawKey为关联
  !isReadonly && track(rawTarget, TrackOpTypes.GET, rawKey)
  // From get:
  // To getProto:
  // Return From getProto: 返回对象原型
  // 从rawTarget获取原型，并从原型中解构出has方法
  const { has } = getProto(rawTarget)
  // From get:
  // To toShallow:
  // Return From toShallow: 啥也没做，返回value值
  // To toReadOnly:
  // Return From toReadOnly: 如果是对象，返回readonly(value)，如果不是对象，返回value
  // To toReactive:
  // Return From toReactive: 如果是对象，返回reactive(value)，如果不是对象，返回value
  const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive
  // 如果rawTraget上有key
  if (has.call(rawTarget, key)) {
    // 这里wrap是包裹一层响应式数据，避免数据污染
    // 返回包裹响应式的target.get(key)
    return wrap(target.get(key))
    // 如果rawTraget上有rawKey
  } else if (has.call(rawTarget, rawKey)) {
    // 这里wrap是包裹一层响应式数据，避免数据污染
    // 返回包裹响应式的target.get(rawKey)
    return wrap(target.get(rawKey))
    // 如果target不等于rawTarget 不等于原始target
  } else if (target !== rawTarget) {
    // #3602 readonly(reactive(Map))
    // ensure that the nested reactive `Map` can do tracking for itself
    // 确保嵌套的响应式 `Map` 可以自己进行跟踪
    target.get(key)
  }
}

function has(this: CollectionTypes, key: unknown, isReadonly = false): boolean {
  const target = (this as any)[ReactiveFlags.RAW]
  const rawTarget = toRaw(target)
  const rawKey = toRaw(key)
  if (key !== rawKey) {
    !isReadonly && track(rawTarget, TrackOpTypes.HAS, key)
  }
  !isReadonly && track(rawTarget, TrackOpTypes.HAS, rawKey)
  return key === rawKey
    ? target.has(key)
    : target.has(key) || target.has(rawKey)
}

function size(target: IterableCollections, isReadonly = false) {
  target = (target as any)[ReactiveFlags.RAW]
  !isReadonly && track(toRaw(target), TrackOpTypes.ITERATE, ITERATE_KEY)
  return Reflect.get(target, 'size', target)
}

function add(this: SetTypes, value: unknown) {
  value = toRaw(value)
  const target = toRaw(this)
  const proto = getProto(target)
  const hadKey = proto.has.call(target, value)
  if (!hadKey) {
    target.add(value)
    trigger(target, TriggerOpTypes.ADD, value, value)
  }
  return this
}

function set(this: MapTypes, key: unknown, value: unknown) {
  value = toRaw(value)
  const target = toRaw(this)
  const { has, get } = getProto(target)

  let hadKey = has.call(target, key)
  if (!hadKey) {
    key = toRaw(key)
    hadKey = has.call(target, key)
  } else if (__DEV__) {
    checkIdentityKeys(target, has, key)
  }

  const oldValue = get.call(target, key)
  target.set(key, value)
  if (!hadKey) {
    trigger(target, TriggerOpTypes.ADD, key, value)
  } else if (hasChanged(value, oldValue)) {
    trigger(target, TriggerOpTypes.SET, key, value, oldValue)
  }
  return this
}

function deleteEntry(this: CollectionTypes, key: unknown) {
  const target = toRaw(this)
  const { has, get } = getProto(target)
  let hadKey = has.call(target, key)
  if (!hadKey) {
    key = toRaw(key)
    hadKey = has.call(target, key)
  } else if (__DEV__) {
    checkIdentityKeys(target, has, key)
  }

  const oldValue = get ? get.call(target, key) : undefined
  // forward the operation before queueing reactions
  const result = target.delete(key)
  if (hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}

function clear(this: IterableCollections) {
  const target = toRaw(this)
  const hadItems = target.size !== 0
  const oldTarget = __DEV__
    ? isMap(target)
      ? new Map(target)
      : new Set(target)
    : undefined
  // forward the operation before queueing reactions
  const result = target.clear()
  if (hadItems) {
    trigger(target, TriggerOpTypes.CLEAR, undefined, undefined, oldTarget)
  }
  return result
}

function createForEach(isReadonly: boolean, isShallow: boolean) {
  return function forEach(
    this: IterableCollections,
    callback: Function,
    thisArg?: unknown
  ) {
    const observed = this as any
    const target = observed[ReactiveFlags.RAW]
    const rawTarget = toRaw(target)
    const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive
    !isReadonly && track(rawTarget, TrackOpTypes.ITERATE, ITERATE_KEY)
    return target.forEach((value: unknown, key: unknown) => {
      // important: make sure the callback is
      // 1. invoked with the reactive map as `this` and 3rd arg
      // 2. the value received should be a corresponding reactive/readonly.
      return callback.call(thisArg, wrap(value), wrap(key), observed)
    })
  }
}

interface Iterable {
  [Symbol.iterator](): Iterator
}

interface Iterator {
  next(value?: any): IterationResult
}

interface IterationResult {
  value: any
  done: boolean
}

function createIterableMethod(
  method: string | symbol,
  isReadonly: boolean,
  isShallow: boolean
) {
  return function (
    this: IterableCollections,
    ...args: unknown[]
  ): Iterable & Iterator {
    const target = (this as any)[ReactiveFlags.RAW]
    const rawTarget = toRaw(target)
    const targetIsMap = isMap(rawTarget)
    const isPair =
      method === 'entries' || (method === Symbol.iterator && targetIsMap)
    const isKeyOnly = method === 'keys' && targetIsMap
    const innerIterator = target[method](...args)
    const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive
    !isReadonly &&
      track(
        rawTarget,
        TrackOpTypes.ITERATE,
        isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY
      )
    // return a wrapped iterator which returns observed versions of the
    // values emitted from the real iterator
    return {
      // iterator protocol
      next() {
        const { value, done } = innerIterator.next()
        return done
          ? { value, done }
          : {
              value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
              done
            }
      },
      // iterable protocol
      [Symbol.iterator]() {
        return this
      }
    }
  }
}

function createReadonlyMethod(type: TriggerOpTypes): Function {
  return function (this: CollectionTypes, ...args: unknown[]) {
    if (__DEV__) {
      const key = args[0] ? `on key "${args[0]}" ` : ``
      console.warn(
        `${capitalize(type)} operation ${key}failed: target is readonly.`,
        toRaw(this)
      )
    }
    return type === TriggerOpTypes.DELETE ? false : this
  }
}
// From createInstrumentationGetter:
function createInstrumentations() {
  // mutableInstrumentations是键类型为string，值类型为Function的对象
  const mutableInstrumentations: Record<string, Function> = {
    // get方法
    // From mutableInstrumentations:
    // To get:
    get(this: MapTypes, key: unknown) {
      return get(this, key)
    },
    // size的getter
    get size() {
      return size(this as unknown as IterableCollections)
    },
    // has
    has,
    // add
    add,
    // set
    set,
    // delte
    delete: deleteEntry,
    // clear
    clear,
    // forEach
    forEach: createForEach(false, false)
  }
  // shallowInstrumentations对象
  const shallowInstrumentations: Record<string, Function> = {
    get(this: MapTypes, key: unknown) {
      return get(this, key, false, true)
    },
    get size() {
      return size(this as unknown as IterableCollections)
    },
    has,
    add,
    set,
    delete: deleteEntry,
    clear,
    forEach: createForEach(false, true)
  }
  // readonlyInstrumentations对象
  const readonlyInstrumentations: Record<string, Function> = {
    get(this: MapTypes, key: unknown) {
      return get(this, key, true)
    },
    get size() {
      return size(this as unknown as IterableCollections, true)
    },
    has(this: MapTypes, key: unknown) {
      return has.call(this, key, true)
    },
    add: createReadonlyMethod(TriggerOpTypes.ADD),
    set: createReadonlyMethod(TriggerOpTypes.SET),
    delete: createReadonlyMethod(TriggerOpTypes.DELETE),
    clear: createReadonlyMethod(TriggerOpTypes.CLEAR),
    forEach: createForEach(true, false)
  }
  // shallowReadonlyInstrumentations对象
  const shallowReadonlyInstrumentations: Record<string, Function> = {
    get(this: MapTypes, key: unknown) {
      return get(this, key, true, true)
    },
    get size() {
      return size(this as unknown as IterableCollections, true)
    },
    has(this: MapTypes, key: unknown) {
      return has.call(this, key, true)
    },
    add: createReadonlyMethod(TriggerOpTypes.ADD),
    set: createReadonlyMethod(TriggerOpTypes.SET),
    delete: createReadonlyMethod(TriggerOpTypes.DELETE),
    clear: createReadonlyMethod(TriggerOpTypes.CLEAR),
    forEach: createForEach(true, true)
  }
  // 通过createIterableMethod方法操作keys values entries Symbol.iterator迭代器方法
  const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator]
  iteratorMethods.forEach(method => {
    mutableInstrumentations[method as string] = createIterableMethod(
      method,
      false,
      false
    )
    readonlyInstrumentations[method as string] = createIterableMethod(
      method,
      true,
      false
    )
    shallowInstrumentations[method as string] = createIterableMethod(
      method,
      false,
      true
    )
    shallowReadonlyInstrumentations[method as string] = createIterableMethod(
      method,
      true,
      true
    )
  })
  // 返回这四个对象
  return [
    mutableInstrumentations,
    readonlyInstrumentations,
    shallowInstrumentations,
    shallowReadonlyInstrumentations
  ]
}
// From createInstrumentationGetter:
// To createInstrumentations:
const [
  mutableInstrumentations,
  readonlyInstrumentations,
  shallowInstrumentations,
  shallowReadonlyInstrumentations
] = /* #__PURE__*/ createInstrumentations()
// From mutableCollectionHandlers get:
function createInstrumentationGetter(isReadonly: boolean, shallow: boolean) {
  // 经过一系列判断获得instrumentations对象
  const instrumentations = shallow
    ? isReadonly
      ? shallowReadonlyInstrumentations
      : shallowInstrumentations
    : isReadonly
    ? readonlyInstrumentations
    : // From createInstrumentationGetter:
      // To mutableInstrumentations:
      mutableInstrumentations
  // 返回一个函数，这个函数就是get
  return (
    target: CollectionTypes,
    key: string | symbol,
    receiver: CollectionTypes
  ) => {
    // 如果key是ReactiveFlags.IS_REACTIVE
    if (key === ReactiveFlags.IS_REACTIVE) {
      // 返回!isReadonly
      return !isReadonly
      // 如果key是ReactiveFlags.IS_READONLY
    } else if (key === ReactiveFlags.IS_READONLY) {
      // 返回isReadonly
      return isReadonly
      // 如果key是ReactiveFlags.RAW
    } else if (key === ReactiveFlags.RAW) {
      // 返回target
      return target
    }
    // 返回Reflect.get操作结果
    return Reflect.get(
      // 如果instrumentations对象是否有key 并且key在target上，返回instrumentations[key]，否则返回target[key]
      hasOwn(instrumentations, key) && key in target
        ? instrumentations
        : target,
      key,
      receiver
    )
  }
}
// From createReactiveObject:
export const mutableCollectionHandlers: ProxyHandler<CollectionTypes> = {
  // get方法来自createInstrumentationGetter方法
  // From createReactiveObject: 
  // To createInstrumentationGetter:
  get: /*#__PURE__*/ createInstrumentationGetter(false, false)
}

export const shallowCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: /*#__PURE__*/ createInstrumentationGetter(false, true)
}

export const readonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: /*#__PURE__*/ createInstrumentationGetter(true, false)
}

export const shallowReadonlyCollectionHandlers: ProxyHandler<CollectionTypes> =
  {
    get: /*#__PURE__*/ createInstrumentationGetter(true, true)
  }

function checkIdentityKeys(
  target: CollectionTypes,
  has: (key: unknown) => boolean,
  key: unknown
) {
  const rawKey = toRaw(key)
  if (rawKey !== key && has.call(target, rawKey)) {
    const type = toRawType(target)
    console.warn(
      `Reactive ${type} contains both the raw and reactive ` +
        `versions of the same object${type === `Map` ? ` as keys` : ``}, ` +
        `which can lead to inconsistencies. ` +
        `Avoid differentiating between the raw and reactive versions ` +
        `of an object and only use the reactive version if possible.`
    )
  }
}
