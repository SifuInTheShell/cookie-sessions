/*
Copyright 2020 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
// Cookie Sessions adaptation: only renderer helpers are retained.
export function shortenText(text) {
  let retVal = '';
  if (text) {
    retVal = text;
    const MAX_LENGTH = 18;
    if (retVal.length > MAX_LENGTH) {
      retVal = retVal.substring(0, MAX_LENGTH-1) + '…';
    }
  }
  return retVal;
}

export function boxFits(a, r, b, w, h) {
  let d = Math.sqrt(Math.pow(r,2)-Math.pow(h/2,2)) -
          Math.max(h*Math.cos(a)/(2*Math.sin(a)), b);
  return d >= w;
}

export function colorIsWhite(color) {
  if (!color) return true;
  return (color.toLowerCase() == '#ffffff');
}

export function getTotalWeight(entries) {
  let totalWeight = 0;
  entries.forEach(entry => {
    if (entry.weight) {
      if (entry.enabled==true || !entry.hasOwnProperty('enabled')) {
        totalWeight += entry.weight;
      }
    }
  });
  return totalWeight;
}