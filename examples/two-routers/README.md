# Two linked routers

```bash
zenohd -c router-a.json5               # tcp/7447, ws 10000
zenohd -c router-b.json5               # tcp/7448, ws 10001, connects to A
python ../pub.py robot1                                  # on A
python ../pub.py robot2 --connect tcp/127.0.0.1:7448     # on B
```

Import `supervisor.config.json`. Both connections see both robots: a message from `robot2` reaches
the supervisor on A after crossing the A-B link, so its latency is higher than `robot1`'s there.

The Overview shows both routers joined by their A-B link (Topology tab per connection for zids and locators).

Don't link routers in a cycle (A->B and B->A, or a client attached to both unlinked routers):
messages loop or go missing. One `connect` from B to A, as here, is enough.
