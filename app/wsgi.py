from .security import Config
from .web import Application

application = Application(Config.from_env())
