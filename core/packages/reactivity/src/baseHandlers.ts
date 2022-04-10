import {
  reactive,
  readonly,
  toRaw,
  ReactiveFlags,
  Target,
  readonlyMap,
  reactiveMap,
  shallowReactiveMap,
  shallowReadonlyMap,
  isReadonly,
  isShallow
} from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import {
  track,
  trigger,
  ITERATE_KEY,
  pauseTracking,
  resetTracking
} from './effect'
import {
  isObject,
  hasOwn,
  isSymbol,
  hasChanged,
  isArray,
  isIntegerKey,
  extend,
  makeMap
} from '@vue/shared'
import { isRef } from './ref'
// From createGetter:
// To makeMap:
// Return From makeMap: 用于检查map中是否有对应key
// Return To createGetter: 检查map中是否有对应key，__proto__,__v_isRef,__isVue
const isNonTrackableKeys = /*#__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

const arrayInstrumentations = /*#__PURE__*/ createArrayInstrumentations()

function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  // instrument identity-sensitive Array methods to account for possible reactive
  // values
  ;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      const arr = toRaw(this) as any
      for (let i = 0, l = this.length; i < l; i++) {
        track(arr, TrackOpTypes.GET, i + '')
      }
      // we run the method using the original args first (which may be reactive)
      const res = arr[key](...args)
      if (res === -1 || res === false) {
        // if that didn't work, run it again using raw values.
        return arr[key](...args.map(toRaw))
      } else {
        return res
      }
    }
  })
  // instrument length-altering mutation methods to avoid length being tracked
  // which leads to infinite loops in some cases (#2137)
  ;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      pauseTracking()
      const res = (toRaw(this) as any)[key].apply(this, args)
      resetTracking()
      return res
    }
  })
  return instrumentations
}
// From get:
function createGetter(isReadonly = false, shallow = false) {
  // 返回get方法
  return function get(target: Target, key: string | symbol, receiver: object) {
    // 如果key已经是reactive，返回!isReadonly
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
      // 如果key已经是readonly，返回isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
      // 如果key是shallow，返回shallow
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return shallow
    } else if (
      // 用于给Set中屏蔽原型引起的更新(之后会细说)
      key === ReactiveFlags.RAW &&
      receiver ===
        (isReadonly
          ? shallow
            ? shallowReadonlyMap
            : readonlyMap
          : shallow
          ? shallowReactiveMap
          : reactiveMap
        ).get(target)
    ) {
      return target
    }
    // 判断target是否是数组
    // From createGetter:
    // To isArray:
    // Retrun From isArray: 返回Array.isArray 判断是否是数组类型
    const targetIsArray = isArray(target)
    // 如果不是只读并且 target是数组类型 并且key存在于arrayInstrumentations上
    // 那么返回定义在arrayInstrumentations上的方法 也就是重写的数组方法
    // From: createGetter:
    // To hasOwn:
    // Return From hasOwn: 判断对象是否有指定的属性
    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      // 返回数组方法
      // From: createGetter:
      //todo To: arrayInstrumentations
      return Reflect.get(arrayInstrumentations, key, receiver)
    }
    // 使用Reflect是为了第三个参数的this
    const res = Reflect.get(target, key, receiver)
    // 不应该在副作用函数与Symbol这类值之间建立响应联系，
    // 如果key的类型是symbol，不需要收集依赖，返回
    // From crateGetter:
    // To isSymbol:
    // Return From isSymbol: 判断是否是Symbol类型
    // To isNonTrackableKeys:
    // Return From isNonTrackableKeys: 判断是否是非跟踪类型 __proto__,__v_isRef,__isVue
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }
    // 如果不是只读，才需要收集依赖，建立响应联系
    if (!isReadonly) {
      // From createGetter:
      //todo To: track 
      track(target, TrackOpTypes.GET, key)
    }
    // 如果是shallow浅响应式，返回经过一次依赖收集的res
    if (shallow) {
      return res
    }
    // 如果是Ref，脱Ref
    // From createGetter:
    //todo To: isRef 
    if (isRef(res)) {
      // ref unwrapping - does not apply for Array + integer key.
      // ref unwrapping - 不适用于 Array + integer key。
      const shouldUnwrap = !targetIsArray || !isIntegerKey(key)
      // 脱ref
      return shouldUnwrap ? res.value : res
    }
    // 如果是对象，根据readonly来决定怎么递归，深只读，深reactive
    // From createGetter:
    // To isObject:
    // Return From isObject: 判断是否是对象类型
    if (isObject(res)) {
      // Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      // 也将返回值转换为代理。 我们进行 isObject 检查
      // 这里是为了避免无效值警告。 还需要惰性访问只读
      // 并在此处进行反应以避免循环依赖。
      // From createGetter:
      //todo To: readonly 
      return isReadonly ? readonly(res) : reactive(res)
    }
    // 最后返回res
    return res
  }
}

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)

function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    let oldValue = (target as any)[key]
    if (isReadonly(oldValue) && isRef(oldValue) && !isRef(value)) {
      return false
    }
    if (!shallow && !isReadonly(value)) {
      if (!isShallow(value)) {
        value = toRaw(value)
        oldValue = toRaw(oldValue)
      }
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

    const hadKey =
      isArray(target) && isIntegerKey(key)
        ? Number(key) < target.length
        : hasOwn(target, key)
    const result = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }
}

function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}

function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    track(target, TrackOpTypes.HAS, key)
  }
  return result
}

function ownKeys(target: object): (string | symbol)[] {
  track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY)
  return Reflect.ownKeys(target)
}
// From createReactiveObject:
// Return To createReactiveObject: 返回如下方法
export const mutableHandlers: ProxyHandler<object> = {
  // To: createGetter
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}
// From createReactiveObject:
// Return To createReactiveObject: 返回如下方法
export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  set(target, key) {
    if (__DEV__) {
      console.warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      console.warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}
// From createReactiveObject:
// To extend: 
// Return From extend: extend就是Object.assign方法
// Return To createReactiveObject: 返回如下方法
export const shallowReactiveHandlers = /*#__PURE__*/ extend(
  {},
  mutableHandlers,
  {
    get: shallowGet,
    set: shallowSet
  }
)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
// From createReactiveObject:
// Return To createReactiveObject: 返回如下方法
export const shallowReadonlyHandlers = /*#__PURE__*/ extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)
