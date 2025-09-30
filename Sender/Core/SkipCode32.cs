using System;
using System.Collections.Generic;
using System.Text;

namespace Sender.Core
{
    public static class SkipCode32
    {
        private const string Alphabet = "0123456789abcdefghijkmnopqrstuvw";
        private static readonly Dictionary<char, int> DecodeMap = BuildDecodeMap();

        private static Dictionary<char, int> BuildDecodeMap()
        {
            var map = new Dictionary<char, int>(64);
            for (int i = 0; i < Alphabet.Length; i++)
            {
                map[Alphabet[i]] = i;
            }

            map['l'] = 1;
            map['L'] = 1;
            map['o'] = 0;
            map['O'] = 0;

            return map;
        }

        public static string Encode(uint mask)
        {
            ulong value = ((ulong)mask << 3) & 0x7FFFFFFFFUL;
            var builder = new StringBuilder(7);
            for (int i = 6; i >= 0; i--)
            {
                int index = (int)((value >> (i * 5)) & 31UL);
                builder.Append(Alphabet[index]);
            }

            return builder.ToString();
        }

        public static bool TryDecode(string code, out uint mask)
        {
            mask = 0;
            if (string.IsNullOrWhiteSpace(code))
            {
                return false;
            }

            code = code.Replace("-", string.Empty).Trim();
            if (code.Length != 7)
            {
                return false;
            }

            ulong value = 0;
            for (int i = 0; i < 7; i++)
            {
                char c = char.ToLowerInvariant(code[i]);
                if (!DecodeMap.TryGetValue(c, out int index))
                {
                    return false;
                }

                value = (value << 5) | (uint)index;
            }

            mask = (uint)((value >> 3) & 0xFFFFFFFFUL);
            return true;
        }

        public static IEnumerable<(int start, int end)> BucketsToSend(uint mask, int total)
        {
            if (total <= 0)
            {
                yield break;
            }

            double bucketSize = total / 32.0;
            for (int bucket = 0; bucket < 32; bucket++)
            {
                bool shouldSend = ((mask >> (31 - bucket)) & 1) != 0;
                if (!shouldSend)
                {
                    continue;
                }

                int start = (int)Math.Floor(bucket * bucketSize);
                int end = Math.Min(total - 1, (int)Math.Floor((bucket + 1) * bucketSize) - 1);
                if (start <= end)
                {
                    yield return (start, end);
                }
            }
        }
    }
}
